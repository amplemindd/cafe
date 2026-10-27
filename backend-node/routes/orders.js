"use strict";
const { api, q, one, tx, cq, fail, audit, notify, paging, like, str, bool, num, r2, can, dateRange, isYmd, getSettings, pool } = require("../lib/core");
const { calculate } = require("../lib/billing");

const TYPES = ["dine_in", "pickup", "delivery", "online"];
const OPEN_SQL = "payment_status = 'unpaid' AND status NOT IN ('cancelled','completed')";
const FLOW = { pending: ["preparing", "ready", "completed", "cancelled"], preparing: ["ready", "completed", "cancelled"], ready: ["completed", "cancelled"], completed: [], cancelled: [] };

async function loadOrder(id, c = pool) {
  const [[o]] = await c.query("SELECT o.*, u.name AS created_by_name FROM bb_orders o LEFT JOIN bb_users u ON u.id = o.created_by WHERE o.id = ?", [id]);
  if (!o) return null;
  const [items] = await c.query("SELECT i.*, (SELECT image_url FROM products WHERE id = i.product_id) AS image_url FROM bb_order_items i WHERE i.order_id = ? ORDER BY i.id", [id]);
  const [payments] = await c.query("SELECT method, amount, reference, status, created_at FROM bb_payments WHERE order_id = ? ORDER BY id", [id]);
  const br = {};
  for (const i of items) if (i.tax_rate > 0) { const b = (br[i.tax_rate] ||= { rate: i.tax_rate, taxable: 0, tax: 0 }); b.taxable = r2(b.taxable + i.taxable); b.tax = r2(b.tax + i.tax_amount); }
  return { ...o, items, payments, tax_breakdown: Object.values(br), is_open: o.payment_status === "unpaid" && !["cancelled", "completed"].includes(o.status) };
}

async function nextBill(c, S) {
  await c.query("UPDATE bb_sequences SET value = LAST_INSERT_ID(value + 1) WHERE name = 'bill'");
  const [[r]] = await c.query("SELECT LAST_INSERT_ID() AS n");
  return `${S.bill_prefix || ""}${r.n}`;
}

async function adjustStock(c, items, sign, ctx) {
  for (const it of items) {
    if (!it.product_id) continue;
    const [[p]] = await c.query("SELECT id, name, track_stock, stock_qty, low_stock_level FROM products WHERE id = ? FOR UPDATE", [it.product_id]);
    if (!p || !p.track_stock) continue;
    const next = p.stock_qty + sign * it.qty;
    await c.query("UPDATE products SET stock_qty = ? WHERE id = ?", [Math.max(next, 0), p.id]);
    if (sign < 0 && next <= 0) await notify({ type: "inventory", title: "Out of Stock", message: `${p.name} is out of stock`, priority: "urgent", link_type: "product", link_id: p.id, dedupe: `out-${p.id}-${Date.now() >> 16}` }, c);
    else if (sign < 0 && next <= p.low_stock_level) await notify({ type: "inventory", title: "Low Stock Alert", message: `${p.name} is running low (only ${next} left)`, priority: "urgent", link_type: "product", link_id: p.id, dedupe: `low-${p.id}-${next}` }, c);
  }
}

function checkPayments(S, payments, total) {
  if (!Array.isArray(payments) || !payments.length) throw fail(400, "Choose a payment method.");
  const enabled = { cash: S.pm_cash, upi: S.pm_upi, card: S.pm_card, wallet: S.pm_wallet };
  let sum = 0;
  const clean = payments.map((p) => {
    const method = String(p.method || "").toLowerCase(), amount = r2(num(p.amount, 0));
    if (!enabled[method]) throw fail(400, `Payment method "${method || "?"}" is not enabled.`);
    if (!(amount > 0)) throw fail(400, "Payment amount must be greater than zero.");
    sum = r2(sum + amount);
    return { method, amount, reference: str(p.reference, 100) || null };
  });
  if (clean.length > 1 && !S.pm_split) throw fail(400, "Split payment is disabled in Settings.");
  if (Math.abs(sum - total) > 0.01) throw fail(400, `Payments (${sum}) must add up to the bill total (${total}).`);
  return clean;
}

async function settle(c, order, payments, ctx, S) {
  const typeDone = order.order_type === "dine_in";
  for (const p of payments)
    await c.query("INSERT INTO bb_payments (order_id, method, amount, reference, status, created_by) VALUES (?,?,?,?, 'paid', ?)", [order.id, p.method, p.amount, p.reference, ctx.user.id]);
  await c.query("UPDATE bb_orders SET payment_status = 'paid', paid_at = NOW(), updated_at = NOW(), status = ?, completed_at = ? WHERE id = ?",
    [typeDone ? "completed" : order.status, typeDone ? new Date() : null, order.id]);
  if (order.table_id) await c.query("UPDATE bb_tables SET status = ?, status_since = NOW() WHERE id = ?", [S.table_after_bill === "cleaning" ? "cleaning" : "available", order.table_id]);
  if (order.customer_id && S.loyalty_per_100 > 0) {
    const pts = Math.floor((order.total / 100) * S.loyalty_per_100);
    if (pts > 0) {
      await c.query("UPDATE bb_customers SET loyalty_points = loyalty_points + ? WHERE id = ?", [pts, order.customer_id]);
      await c.query("INSERT INTO bb_loyalty_tx (customer_id, order_id, points, type, note) VALUES (?,?,?, 'earned', ?)", [order.customer_id, order.id, pts, `Bill ${order.bill_no}`]);
    }
  }
  const methods = payments.map((p) => p.method.toUpperCase()).join(" + ");
  await notify({ type: "payment", title: "Payment Received", message: `Order ${order.bill_no} - ₹${order.total} received via ${methods}`, link_type: "order", link_id: order.id }, c);
  await audit(ctx, { action: "Paid", module: "Orders", details: `Payment ₹${order.total} (${methods}) for ${order.bill_no}`, record_id: order.id }, c);
}

/* ---------- create / update an order (hold or pay) ---------- */
async function saveOrder(ctx, orderId) {
  const b = ctx.body, S = await getSettings(), user = ctx.user;
  const action = b.action === "pay" ? "pay" : "hold";
  const type = b.order_type;
  if (!["dine_in", "pickup", "delivery"].includes(type)) throw fail(400, "Choose an order type.");
  if ((type === "dine_in" && !S.dine_in_enabled) || (type === "pickup" && !S.takeaway_enabled) || (type === "delivery" && !S.delivery_enabled)) throw fail(400, "This order type is disabled in Settings.");
  const lines = new Map();
  for (const it of Array.isArray(b.items) ? b.items : []) {
    const pid = Number(it.product_id), qty = Math.floor(num(it.qty, 0));
    if (!Number.isInteger(pid) || pid <= 0 || qty < 1 || qty > 99) throw fail(400, "Invalid item in the cart.");
    lines.set(pid, Math.min((lines.get(pid) || 0) + qty, 99));
  }
  if (!lines.size) throw fail(400, "Add at least one item to the order.");
  const customerName = str(b.customer_name, 100), phone = str(b.customer_phone, 20).replace(/[\s-]/g, ""), address = str(b.delivery_address, 255);
  if (phone && !/^\+?\d{7,15}$/.test(phone)) throw fail(400, "Enter a valid customer phone number.");
  if (type === "delivery" && (!customerName || !phone || !address)) throw fail(400, "Delivery orders need customer name, phone and address.");
  const key = str(b.idempotency_key, 64) || null;
  if (key && !orderId) {
    const dup = await one("SELECT id FROM bb_orders WHERE idempotency_key = ?", [key]);
    if (dup) return { order: await loadOrder(dup.id), duplicate: true };
  }
  const dtype = b.discount?.type === "percent" ? "percent" : "fixed", dvalue = Math.max(num(b.discount?.value, 0), 0);
  if (dvalue > 0 && (!S.allow_discounts || !can(user, "discount"))) throw fail(403, "You are not allowed to apply discounts.");

  const order = await tx(async (c) => {
    let old = null;
    if (orderId) {
      [[old]] = await c.query("SELECT * FROM bb_orders WHERE id = ? FOR UPDATE", [orderId]);
      if (!old) throw fail(404, "Order not found.");
      if (old.payment_status !== "unpaid" || ["cancelled", "completed"].includes(old.status)) throw fail(409, "This order is already closed and cannot be changed.");
    }
    // table
    let table = null;
    if (type === "dine_in") {
      if (!b.table_id) throw fail(400, "Please select a table for Dine In.");
      [[table]] = await c.query("SELECT * FROM bb_tables WHERE id = ? AND is_active = 1 FOR UPDATE", [Number(b.table_id)]);
      if (!table) throw fail(400, "Selected table does not exist.");
      if (table.status === "out_of_service") throw fail(409, `${table.name} is out of service.`);
      const [busy] = await c.query(`SELECT bill_no FROM bb_orders WHERE table_id = ? AND ${OPEN_SQL} AND id <> ? FOR UPDATE`, [table.id, orderId || 0]);
      if (busy.length) throw fail(409, `${table.name} already has an active order (${busy[0].bill_no}). Open that order to add items.`);
      if (table.status === "reserved" && !(old && old.table_id === table.id)) throw fail(409, `${table.name} is reserved. Mark it Available first.`);
    }
    // stock restore for edits, then products
    if (old) { const [oldItems] = await c.query("SELECT product_id, qty FROM bb_order_items WHERE order_id = ?", [old.id]); await adjustStock(c, oldItems, +1, ctx); }
    const ids = [...lines.keys()];
    const [prods] = await c.query(
      `SELECT p.*, c.name AS cat_name, c.tax_rate_id AS cat_tax, c.is_active AS cat_active, c.show_in_pos AS cat_pos
       FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id IN (?) FOR UPDATE`, [ids]);
    if (prods.length !== ids.length) throw fail(400, "Some items no longer exist. Please refresh the menu.");
    const [rates] = await c.query("SELECT id, rate, is_active FROM bb_tax_rates");
    const rateOf = (id) => { const r = rates.find((x) => x.id === id); return r && r.is_active ? Number(r.rate) : 0; };
    const calcLines = prods.map((p) => {
      if (!p.is_active || !p.show_in_pos || p.is_archived || p.cat_active === 0 || p.cat_pos === 0) throw fail(400, `"${p.name}" is not available for sale.`);
      const qty = lines.get(p.id);
      if (p.track_stock && p.stock_qty < qty) throw fail(400, `Only ${p.stock_qty} of "${p.name}" left in stock.`);
      const tid = p.tax_rate_id || p.cat_tax || S.default_tax_rate_id;
      const taxOn = S.tax_enabled && S.auto_tax;
      return { product_id: p.id, product_name: p.name, category_name: p.cat_name, unit_price: Number(p.mrp), qty, tax_rate: taxOn ? rateOf(tid) : 0 };
    });
    const calc = calculate({ lines: calcLines, discount: { type: dtype, value: dvalue }, mode: S.tax_mode, round: S.round_off });
    if (dvalue > 0 && user.role !== "admin" && user.role !== "manager") {
      const pct = calc.subtotal ? (calc.discount_amount / calc.subtotal) * 100 : 0;
      if (pct > S.discount_limit_cashier + 0.001) throw fail(403, `Discounts above ${S.discount_limit_cashier}% need manager approval.`);
    }
    // customer (link by phone, avoid duplicates)
    let customerId = b.customer_id ? Number(b.customer_id) : null, cname = customerName || "Walk-in", cphone = phone || null;
    if (customerId) {
      const [[cu]] = await c.query("SELECT id, name, phone FROM bb_customers WHERE id = ?", [customerId]);
      if (!cu) customerId = null; else { cname = customerName || cu.name; cphone = phone || cu.phone; }
    } else if (phone) {
      const [[cu]] = await c.query("SELECT id, name FROM bb_customers WHERE phone = ?", [phone]);
      if (cu) { customerId = cu.id; cname = customerName || cu.name; }
      else {
        const [r] = await c.query("INSERT INTO bb_customers (name, phone, address) VALUES (?,?,?)", [customerName || "Customer", phone, address || null]);
        customerId = r.insertId; cname = customerName || "Customer";
        await notify({ type: "customer", title: "New Customer Registered", message: `${cname} - ${phone}`, link_type: "customer", link_id: customerId }, c);
      }
    }
    // order row
    const common = [type, table ? table.id : null, table ? table.name : null, customerId, cname, cphone, address || null, Math.min(Math.max(Math.floor(num(b.guests, 1)), 1), 99),
      str(b.notes, 255) || null, calc.subtotal, dvalue > 0 ? dtype : null, dvalue, calc.discount_amount, dvalue > 0 ? user.id : null, calc.taxable_amount, calc.tax_amount, calc.round_off, calc.total, S.tax_mode];
    let id = orderId, bill;
    if (old) {
      await c.query(`UPDATE bb_orders SET order_type=?, table_id=?, table_name=?, customer_id=?, customer_name=?, customer_phone=?, delivery_address=?, guests=?, notes=?, subtotal=?,
        discount_type=?, discount_value=?, discount_amount=?, discount_by=?, taxable_amount=?, tax_amount=?, round_off=?, total=?, tax_mode=?, updated_at=NOW() WHERE id=?`, [...common, id]);
      await c.query("DELETE FROM bb_order_items WHERE order_id = ?", [id]);
      if (old.table_id && old.table_id !== (table ? table.id : null)) await c.query("UPDATE bb_tables SET status='available', status_since=NOW() WHERE id = ?", [old.table_id]);
      bill = old.bill_no;
    } else {
      bill = await nextBill(c, S);
      const [r] = await c.query(`INSERT INTO bb_orders (bill_no, order_type, table_id, table_name, customer_id, customer_name, customer_phone, delivery_address, guests, notes, subtotal,
        discount_type, discount_value, discount_amount, discount_by, taxable_amount, tax_amount, round_off, total, tax_mode, created_by, idempotency_key, status, payment_status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', 'unpaid')`, [bill, ...common, user.id, key]);
      id = r.insertId;
    }
    for (const l of calc.lines)
      await c.query(`INSERT INTO bb_order_items (order_id, product_id, product_name, category_name, unit_price, qty, line_subtotal, discount_amount, taxable, tax_rate, tax_amount, line_total)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [id, l.product_id, l.product_name, l.category_name, l.unit_price, l.qty, l.line_subtotal, l.discount_amount, l.taxable, l.tax_rate, l.tax_amount, l.line_total]);
    await adjustStock(c, calc.lines, -1, ctx);
    if (table) await c.query("UPDATE bb_tables SET status='occupied', status_since = COALESCE(status_since, NOW()), reserved_for=NULL, reserved_phone=NULL, reserved_at=NULL WHERE id = ?", [table.id]);

    const full = { id, bill_no: bill, order_type: type, table_id: table ? table.id : null, customer_id: customerId, total: calc.total, status: old ? old.status : "pending" };
    if (action === "pay") await settle(c, full, checkPayments(S, b.payments, calc.total), ctx, S);
    if (!old) {
      await notify({ type: "order", title: `New Order ${bill}`, message: `${table ? table.name + " (Dine In)" : type === "pickup" ? "Pick Up" : "Delivery"} - ₹${calc.total}`, priority: "high", link_type: "order", link_id: id }, c);
      await audit(ctx, { action: "Created", module: "Orders", details: `Created order ${bill}${table ? " (Table " + table.name + ")" : ""}`, record_id: id }, c);
    } else await audit(ctx, { action: "Updated", module: "Orders", details: `Updated order ${bill} (items / totals)`, record_id: id }, c);
    return id;
  });
  return { order: await loadOrder(order) };
}

api.post("/api/orders", "pos", async (ctx) => {
  if (ctx.body.id) { const r = await saveOrder(ctx, Number(ctx.body.id)); return { ...r, message: ctx.body.action === "pay" ? "Payment successful." : "Order saved." }; }
  try { const r = await saveOrder(ctx, null); return { __status: r.duplicate ? 200 : 201, ...r, message: ctx.body.action === "pay" ? "Payment successful." : "Order saved." }; }
  catch (e) {
    if (e.code === "ER_DUP_ENTRY" && ctx.body.idempotency_key) { const d = await one("SELECT id FROM bb_orders WHERE idempotency_key = ?", [String(ctx.body.idempotency_key).slice(0, 64)]); if (d) return { order: await loadOrder(d.id), duplicate: true }; }
    throw e;
  }
});
api.put("/api/orders/:id", "pos", async (ctx) => ({ ...(await saveOrder(ctx, Number(ctx.params.id))), message: "Order updated." }));

api.post("/api/orders/:id/payments", "pos", async (ctx) => {
  const id = Number(ctx.params.id), S = await getSettings();
  await tx(async (c) => {
    const [[o]] = await c.query("SELECT * FROM bb_orders WHERE id = ? FOR UPDATE", [id]);
    if (!o) throw fail(404, "Order not found.");
    if (o.payment_status === "paid") throw fail(409, "This order is already paid.");
    if (o.status === "cancelled") throw fail(409, "This order was cancelled.");
    await settle(c, o, checkPayments(S, ctx.body.payments, o.total), ctx, S);
  });
  return { order: await loadOrder(id), message: "Payment successful." };
});
api.get("/api/orders/:id/payments", "orders", async (ctx) => ({ payments: await q("SELECT method, amount, reference, status, created_at FROM bb_payments WHERE order_id = ?", [Number(ctx.params.id)]) }));

/* ---------- list ---------- */
api.get("/api/orders/open", "pos", async () => ({ orders: await q(`SELECT id, bill_no, order_type, table_id, table_name, customer_name, total, created_at FROM bb_orders WHERE ${OPEN_SQL} ORDER BY id DESC`) }));

api.get("/api/orders", "orders", async (ctx) => {
  const Q = ctx.query, base = [], p = [];
  if (isYmd(Q.from)) { base.push("DATE(o.created_at) >= ?"); p.push(Q.from); }
  if (isYmd(Q.to)) { base.push("DATE(o.created_at) <= ?"); p.push(Q.to); }
  if (Q.q) { base.push("(o.bill_no LIKE ? OR o.table_name LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)"); p.push(like(Q.q), like(Q.q), like(Q.q), like(Q.q)); }
  const filters = [...base], fp = [...p];
  if (Q.type && Q.type !== "all") { filters.push("o.order_type = ?"); fp.push(Q.type); }
  if (Q.status && Q.status !== "all") { filters.push("o.status = ?"); fp.push(Q.status); }
  if (Q.payment_status && Q.payment_status !== "all") { filters.push("o.payment_status = ?"); fp.push(Q.payment_status); }
  if (Q.method && Q.method !== "all") { filters.push("EXISTS (SELECT 1 FROM bb_payments x WHERE x.order_id = o.id AND x.method = ?)"); fp.push(Q.method); }
  const w = filters.length ? filters.join(" AND ") : "1=1", bw = base.length ? base.join(" AND ") : "1=1";
  const { limit, offset } = paging(Q, 10);
  const [{ total }] = await q(`SELECT COUNT(*) total FROM bb_orders o WHERE ${w}`, fp);
  const rows = await q(`SELECT o.id, o.bill_no, o.created_at, o.order_type, o.table_name, o.customer_name, o.customer_phone, o.total, o.status, o.payment_status, o.tax_amount, o.discount_amount,
      (SELECT COALESCE(SUM(qty),0) FROM bb_order_items WHERE order_id = o.id) AS items,
      (SELECT GROUP_CONCAT(DISTINCT method) FROM bb_payments WHERE order_id = o.id) AS methods
    FROM bb_orders o WHERE ${w} ORDER BY o.id DESC LIMIT ? OFFSET ?`, [...fp, limit, offset]);
  const types = await q(`SELECT order_type k, COUNT(*) n FROM bb_orders o WHERE ${bw} GROUP BY order_type`, p);
  const statuses = await q(`SELECT status k, COUNT(*) n FROM bb_orders o WHERE ${bw} GROUP BY status`, p);
  const toMap = (a) => Object.fromEntries(a.map((x) => [x.k, x.n]));
  const [{ open }] = await q(`SELECT COUNT(*) open FROM bb_orders WHERE ${OPEN_SQL}`);
  return { orders: rows, total, counts: { type: toMap(types), status: toMap(statuses) }, open };
});

api.get("/api/orders/held", "pos", async () => ({ orders: await q(`SELECT id FROM bb_orders WHERE ${OPEN_SQL}`) }));

api.get("/api/orders/:id", "orders", async (ctx) => {
  const o = await loadOrder(Number(ctx.params.id));
  if (!o) throw fail(404, "Order not found.");
  return { order: o };
});

api.get("/api/orders/:id/receipt", "orders", async (ctx) => {
  const o = await loadOrder(Number(ctx.params.id));
  if (!o) throw fail(404, "Order not found.");
  const S = await getSettings();
  const keys = ["restaurant_name", "logo_url", "phone", "email", "address", "gstin", "show_logo", "show_restaurant_details", "show_gst_details", "show_thanks", "footer_message", "paper_size", "show_tax_on_bill", "tax_mode", "currency", "date_format"];
  return { order: o, receipt_settings: Object.fromEntries(keys.map((k) => [k, S[k]])) };
});

/* ---------- status / cancel ---------- */
api.patch("/api/orders/:id/status", "orders", async (ctx) => {
  const id = Number(ctx.params.id), next = String(ctx.body.status || "");
  if (!can(ctx.user, "pos") && !can(ctx.user, "orders.cancel")) throw fail(403, "You do not have permission to change order status.");
  if (next === "cancelled") throw fail(400, "Use the Cancel Order action (a reason is required).");
  const S = await getSettings();
  await tx(async (c) => {
    const [[o]] = await c.query("SELECT * FROM bb_orders WHERE id = ? FOR UPDATE", [id]);
    if (!o) throw fail(404, "Order not found.");
    if (!(FLOW[o.status] || []).includes(next)) throw fail(400, `An order that is ${o.status} cannot be changed to ${next}.`);
    if (next === "completed" && o.payment_status !== "paid") throw fail(400, "Collect the payment before completing the order.");
    await c.query("UPDATE bb_orders SET status = ?, updated_at = NOW(), completed_at = ? WHERE id = ?", [next, next === "completed" ? new Date() : null, id]);
    if (next === "completed" && o.table_id) await c.query("UPDATE bb_tables SET status = ?, status_since = NOW() WHERE id = ? AND status = 'occupied'", [S.table_after_bill === "cleaning" ? "cleaning" : "available", o.table_id]);
    await audit(ctx, { action: "Updated", module: "Orders", details: `Order ${o.bill_no} status ${o.status} → ${next}`, record_id: id, old: { status: o.status }, neu: { status: next } }, c);
  });
  return { order: await loadOrder(id), message: `Order marked ${next}.` };
});

api.post("/api/orders/:id/cancel", "orders.cancel", async (ctx) => {
  const id = Number(ctx.params.id), reason = str(ctx.body.reason, 255);
  if (reason.length < 3) throw fail(400, "Please enter a reason for cancelling.");
  await tx(async (c) => {
    const [[o]] = await c.query("SELECT * FROM bb_orders WHERE id = ? FOR UPDATE", [id]);
    if (!o) throw fail(404, "Order not found.");
    if (o.status === "cancelled") throw fail(409, "This order is already cancelled.");
    const wasPaid = o.payment_status === "paid";
    await c.query("UPDATE bb_orders SET status='cancelled', payment_status = ?, cancel_reason=?, cancelled_by=?, cancelled_at=NOW(), updated_at=NOW() WHERE id=?", [wasPaid ? "refunded" : "unpaid", reason, ctx.user.id, id]);
    if (wasPaid) await c.query("UPDATE bb_payments SET status='refunded' WHERE order_id = ?", [id]);
    const [items] = await c.query("SELECT product_id, qty FROM bb_order_items WHERE order_id = ?", [id]);
    await adjustStock(c, items, +1, ctx);
    if (o.table_id) await c.query("UPDATE bb_tables SET status='available', status_since=NOW() WHERE id = ? AND status IN ('occupied','cleaning')", [o.table_id]);
    if (wasPaid && o.customer_id) {
      const [[earn]] = await c.query("SELECT COALESCE(SUM(points),0) pts FROM bb_loyalty_tx WHERE order_id = ? AND type = 'earned'", [id]);
      if (earn.pts > 0) {
        await c.query("UPDATE bb_customers SET loyalty_points = GREATEST(loyalty_points - ?, 0) WHERE id = ?", [earn.pts, o.customer_id]);
        await c.query("INSERT INTO bb_loyalty_tx (customer_id, order_id, points, type, note) VALUES (?,?,?, 'reversed', ?)", [o.customer_id, id, -earn.pts, `Cancelled ${o.bill_no}`]);
      }
    }
    await audit(ctx, { action: "Cancelled", module: "Orders", details: `Cancelled order ${o.bill_no}${wasPaid ? " (payment refunded)" : ""}: ${reason}`, record_id: id, level: wasPaid ? "critical" : "warning" }, c);
    await notify({ type: "order", title: `Order ${o.bill_no} Cancelled`, message: reason, priority: "high", link_type: "order", link_id: id }, c);
  });
  return { order: await loadOrder(id), message: "Order cancelled." };
});

/* ---------- live bill preview (server-side calculation, nothing is saved) ---------- */
api.post("/api/orders/preview", "pos", async (ctx) => {
  const S = await getSettings(), b = ctx.body, lines = new Map();
  for (const it of Array.isArray(b.items) ? b.items : []) { const pid = Number(it.product_id), qty = Math.floor(num(it.qty, 0)); if (pid > 0 && qty >= 1) lines.set(pid, Math.min((lines.get(pid) || 0) + qty, 99)); }
  if (!lines.size) return { calc: null };
  const prods = await q("SELECT p.id, p.name, p.mrp, p.tax_rate_id, c.tax_rate_id AS cat_tax FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id IN (?)", [[...lines.keys()]]);
  const rates = await q("SELECT id, rate, is_active FROM bb_tax_rates");
  const rateOf = (id) => { const r = rates.find((x) => x.id === id); return r && r.is_active ? Number(r.rate) : 0; };
  const calcLines = prods.map((p) => ({ product_id: p.id, product_name: p.name, unit_price: Number(p.mrp), qty: lines.get(p.id), tax_rate: S.tax_enabled && S.auto_tax ? rateOf(p.tax_rate_id || p.cat_tax || S.default_tax_rate_id) : 0 }));
  const dtype = b.discount?.type === "percent" ? "percent" : "fixed";
  const dvalue = S.allow_discounts && can(ctx.user, "discount") ? Math.max(num(b.discount?.value, 0), 0) : 0;
  const c = calculate({ lines: calcLines, discount: { type: dtype, value: dvalue }, mode: S.tax_mode, round: S.round_off });
  return { calc: { subtotal: c.subtotal, discount_amount: c.discount_amount, tax_amount: c.tax_amount, round_off: c.round_off, total: c.total, breakdown: c.breakdown, mode: S.tax_mode } };
});

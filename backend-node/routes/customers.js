"use strict";
const { api, q, one, fail, audit, notify, paging, like, str, num, ymd, pool } = require("../lib/core");

const PAID = "o.payment_status = 'paid' AND o.status <> 'cancelled'";
const memberType = (spent) => (spent >= 10000 ? "Gold" : spent >= 3000 ? "Silver" : "Regular");

const SELECT = `SELECT c.*, 
  (SELECT COUNT(*) FROM bb_orders o WHERE o.customer_id = c.id AND ${PAID}) AS total_orders,
  (SELECT COALESCE(SUM(o.total),0) FROM bb_orders o WHERE o.customer_id = c.id AND ${PAID}) AS total_spent,
  (SELECT MAX(DATE(o.created_at)) FROM bb_orders o WHERE o.customer_id = c.id) AS last_visit
  FROM bb_customers c`;
const shape = (c) => ({ ...c, member_type: memberType(c.total_spent) });

api.get("/api/customers", "customers", async (ctx) => {
  const where = ["1=1"], p = [], Q = ctx.query;
  if (Q.q) { where.push("(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)"); p.push(like(Q.q), like(Q.q), like(Q.q)); }
  if (Q.status === "active" || Q.status === "inactive") { where.push("c.status = ?"); p.push(Q.status); }
  const { limit, offset } = paging(Q, 10, 500);
  const w = where.join(" AND ");
  const [{ total }] = await q(`SELECT COUNT(*) total FROM bb_customers c WHERE ${w}`, p);
  const rows = await q(`${SELECT} WHERE ${w} ORDER BY c.id DESC LIMIT ? OFFSET ?`, [...p, limit, offset]);
  const month = ymd().slice(0, 7);
  const [s] = await q(`SELECT (SELECT COUNT(*) FROM bb_customers) AS customers,
    (SELECT COUNT(*) FROM bb_customers WHERE DATE_FORMAT(created_at,'%Y-%m') = ?) AS new_month,
    (SELECT COUNT(*) FROM bb_orders o WHERE o.customer_id IS NOT NULL AND ${PAID}) AS orders,
    (SELECT COALESCE(SUM(o.total),0) FROM bb_orders o WHERE o.customer_id IS NOT NULL AND ${PAID}) AS sales`, [month]);
  return { customers: rows.map(shape), total, summary: s };
});

api.get("/api/customers/:id", "customers", async (ctx) => {
  const c = await one(`${SELECT} WHERE c.id = ?`, [Number(ctx.params.id)]);
  if (!c) throw fail(404, "Customer not found.");
  const orders = await q("SELECT id, bill_no, created_at, total, status, payment_status, (SELECT COALESCE(SUM(qty),0) FROM bb_order_items WHERE order_id = bb_orders.id) AS items FROM bb_orders WHERE customer_id = ? ORDER BY id DESC LIMIT 50", [c.id]);
  const rewards = await q("SELECT points, type, note, created_at FROM bb_loyalty_tx WHERE customer_id = ? ORDER BY id DESC LIMIT 50", [c.id]);
  return { customer: shape(c), orders, rewards };
});

api.get("/api/customers/:id/orders", "customers", async (ctx) => ({
  orders: await q("SELECT id, bill_no, created_at, total, status, payment_status FROM bb_orders WHERE customer_id = ? ORDER BY id DESC LIMIT 100", [Number(ctx.params.id)]),
}));

function body(b) {
  const name = str(b.name, 100), phone = str(b.phone, 20).replace(/[\s-]/g, ""), email = str(b.email, 150);
  if (!name) throw fail(400, "Customer name is required.");
  if (phone && !/^\+?\d{7,15}$/.test(phone)) throw fail(400, "Enter a valid phone number (7 to 15 digits).");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(400, "Enter a valid email address.");
  const bd = str(b.birthday, 10);
  if (bd && !/^\d{4}-\d{2}-\d{2}$/.test(bd)) throw fail(400, "Birthday must be a valid date.");
  return { name, phone: phone || null, email: email || null, address: str(b.address, 255) || null, birthday: bd || null, notes: str(b.notes, 500) || null,
    status: b.status === "inactive" ? "inactive" : "active" };
}

api.post("/api/customers", "customers.manage", async (ctx) => {
  const v = body(ctx.body);
  if (v.phone && (await one("SELECT id FROM bb_customers WHERE phone = ?", [v.phone]))) throw fail(409, "A customer with this phone number already exists.");
  const r = (await pool.query("INSERT INTO bb_customers (name, phone, email, address, birthday, notes, status) VALUES (?,?,?,?,?,?,?)",
    [v.name, v.phone, v.email, v.address, v.birthday, v.notes, v.status]))[0];
  await audit(ctx, { action: "Created", module: "Customers", details: `Added customer "${v.name}"`, record_id: r.insertId });
  await notify({ type: "customer", title: "New Customer Registered", message: `${v.name}${v.phone ? " - " + v.phone : ""} registered as a new customer`, link_type: "customer", link_id: r.insertId });
  return { __status: 201, id: r.insertId, message: "Customer added." };
});

api.put("/api/customers/:id", "customers.manage", async (ctx) => {
  const id = Number(ctx.params.id), v = body(ctx.body);
  if (v.phone && (await one("SELECT id FROM bb_customers WHERE phone = ? AND id <> ?", [v.phone, id]))) throw fail(409, "Another customer already uses this phone number.");
  const r = (await pool.query("UPDATE bb_customers SET name=?, phone=?, email=?, address=?, birthday=?, notes=?, status=? WHERE id=?",
    [v.name, v.phone, v.email, v.address, v.birthday, v.notes, v.status, id]))[0];
  if (!r.affectedRows) throw fail(404, "Customer not found.");
  await audit(ctx, { action: "Updated", module: "Customers", details: `Updated customer "${v.name}"`, record_id: id });
  return { message: "Customer updated." };
});

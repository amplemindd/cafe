"use strict";
const { api, q, one, tx, cq, fail, audit, notify, paging, like, str, bool, num, getSettings, pool } = require("../lib/core");

const STATUSES = ["available", "occupied", "reserved", "cleaning", "out_of_service"];
const OPEN = "o.payment_status = 'unpaid' AND o.status NOT IN ('cancelled','completed')";

const SELECT = `SELECT t.*, o.id AS order_id, o.bill_no, o.total AS order_total, o.guests, o.customer_name, o.created_at AS order_started
  FROM bb_tables t LEFT JOIN bb_orders o ON o.table_id = t.id AND ${OPEN} WHERE t.is_active = 1`;

function shape(t) {
  const status = t.order_id ? "occupied" : t.status === "occupied" ? "available" : t.status;
  return { id: t.id, name: t.name, capacity: t.capacity, status, status_since: t.order_started || t.status_since, reserved_for: t.reserved_for, reserved_phone: t.reserved_phone,
    reserved_at: t.reserved_at, order: t.order_id ? { id: t.order_id, bill_no: t.bill_no, total: t.order_total, guests: t.guests, customer_name: t.customer_name } : null };
}

api.get("/api/tables", "auth", async (ctx) => {
  const rows = await q(`${SELECT} ORDER BY t.sort_order, t.id`);
  let tables = rows.map(shape);
  if (ctx.query.status) tables = tables.filter((t) => t.status === ctx.query.status);
  const counts = {};
  for (const t of rows.map(shape)) counts[t.status] = (counts[t.status] || 0) + 1;
  return { tables, counts, total: rows.length };
});

api.get("/api/tables/:id", "auth", async (ctx) => {
  const t = await one(`${SELECT} AND t.id = ?`, [Number(ctx.params.id)]);
  if (!t) throw fail(404, "Table not found.");
  const out = shape(t);
  if (t.order_id) {
    out.items = await q("SELECT product_name, unit_price, qty, line_total, (SELECT image_url FROM products WHERE id = product_id) image_url FROM bb_order_items WHERE order_id = ? ORDER BY id", [t.order_id]);
    const [o] = await q("SELECT subtotal, discount_amount, tax_amount, round_off, total, order_type, customer_name FROM bb_orders WHERE id = ?", [t.order_id]);
    out.order = { ...out.order, ...o };
  }
  return { table: out };
});

function body(b) {
  const name = str(b.name, 50);
  if (!name) throw fail(400, "Table name is required.");
  return { name, capacity: Math.min(Math.max(Math.floor(num(b.capacity, 4)), 1), 50) };
}

api.post("/api/tables", "tables.manage", async (ctx) => {
  const S = await getSettings();
  let { name, capacity } = body({ ...ctx.body, name: ctx.body.name || "auto" });
  if (!ctx.body.name || ctx.body.name === "auto") {
    const rows = await q("SELECT name FROM bb_tables");
    const re = new RegExp(`^${S.table_prefix}(\\d+)$`);
    const max = rows.reduce((m, r) => Math.max(m, (re.exec(r.name) || [0, 0])[1] * 1), 0);
    name = `${S.table_prefix}${max + 1}`;
  }
  if (ctx.body.capacity === undefined) capacity = S.default_table_capacity;
  if (await one("SELECT id FROM bb_tables WHERE name = ?", [name])) throw fail(409, "A table with this name already exists.");
  const [{ m }] = await q("SELECT COALESCE(MAX(sort_order),0)+1 m FROM bb_tables");
  const r = (await pool.query("INSERT INTO bb_tables (name, capacity, sort_order, status_since) VALUES (?,?,?,NOW())", [name, capacity, m]))[0];
  await audit(ctx, { action: "Created", module: "Tables", details: `Added table ${name}`, record_id: r.insertId });
  return { __status: 201, id: r.insertId, message: `Table ${name} added.` };
});

api.put("/api/tables/:id", "tables.manage", async (ctx) => {
  const id = Number(ctx.params.id), v = body(ctx.body);
  if (await one("SELECT id FROM bb_tables WHERE name = ? AND id <> ?", [v.name, id])) throw fail(409, "A table with this name already exists.");
  const r = (await pool.query("UPDATE bb_tables SET name = ?, capacity = ? WHERE id = ? AND is_active = 1", [v.name, v.capacity, id]))[0];
  if (!r.affectedRows) throw fail(404, "Table not found.");
  await q("UPDATE bb_orders SET table_name = ? WHERE table_id = ? AND payment_status = 'unpaid' AND status NOT IN ('cancelled','completed')", [v.name, id]);
  await audit(ctx, { action: "Updated", module: "Tables", details: `Updated table ${v.name}`, record_id: id });
  return { message: "Table updated." };
});

api.patch("/api/tables/:id/status", "tables", async (ctx) => {
  const id = Number(ctx.params.id), status = ctx.body.status;
  if (!STATUSES.includes(status) || status === "occupied") throw fail(400, "Choose a valid status. A table becomes occupied automatically when an order is started.");
  const t = await one(`${SELECT} AND t.id = ?`, [id]);
  if (!t) throw fail(404, "Table not found.");
  if (t.order_id) throw fail(409, `${t.name} has an active order (${t.bill_no}). Complete or cancel it first.`);
  if (status === "reserved") {
    const who = str(ctx.body.reserved_for, 100);
    if (!who) throw fail(400, "Enter the customer name for the reservation.");
    await q("UPDATE bb_tables SET status='reserved', status_since=NOW(), reserved_for=?, reserved_phone=?, reserved_at=? WHERE id=?",
      [who, str(ctx.body.reserved_phone, 30) || null, ctx.body.reserved_at ? String(ctx.body.reserved_at).replace("T", " ").slice(0, 19) : null, id]);
    await notify({ type: "table", title: `Table ${t.name} Reserved`, message: `${who}${ctx.body.reserved_at ? " - " + String(ctx.body.reserved_at).replace("T", " ") : ""}`, link_type: "table", link_id: id });
  } else {
    await q("UPDATE bb_tables SET status=?, status_since=NOW(), reserved_for=NULL, reserved_phone=NULL, reserved_at=NULL WHERE id=?", [status, id]);
  }
  await audit(ctx, { action: "Updated", module: "Tables", details: `Table ${t.name} marked ${status.replace("_", " ")}`, record_id: id });
  return { message: `${t.name} is now ${status.replace("_", " ")}.` };
});

api.post("/api/tables/:id/move", "pos", async (ctx) => {
  const from = Number(ctx.params.id), to = Number(ctx.body.to_table_id);
  await tx(async (c) => {
    const [[a]] = await c.query(`${SELECT} AND t.id = ? FOR UPDATE`, [from]);
    const [[b]] = await c.query(`${SELECT} AND t.id = ?`, [to]);
    if (!a || !b) throw fail(404, "Table not found.");
    if (!a.order_id) throw fail(400, "This table has no active order to move.");
    if (b.order_id || !["available", "cleaning"].includes(b.status)) throw fail(409, `${b.name} is not available.`);
    await c.query("UPDATE bb_orders SET table_id = ?, table_name = ? WHERE id = ?", [b.id, b.name, a.order_id]);
    await c.query("UPDATE bb_tables SET status='available', status_since=NOW() WHERE id = ?", [a.id]);
    await c.query("UPDATE bb_tables SET status='occupied', status_since=NOW() WHERE id = ?", [b.id]);
    await audit(ctx, { action: "Updated", module: "Tables", details: `Moved order ${a.bill_no} from ${a.name} to ${b.name}`, record_id: a.order_id }, c);
  });
  return { message: "Order moved to the new table." };
});

api.delete("/api/tables/:id", "tables.manage", async (ctx) => {
  const id = Number(ctx.params.id);
  const t = await one(`${SELECT} AND t.id = ?`, [id]);
  if (!t) throw fail(404, "Table not found.");
  if (t.order_id) throw fail(409, "This table has an active order.");
  const [{ n }] = await q("SELECT COUNT(*) n FROM bb_orders WHERE table_id = ?", [id]);
  if (n) await q("UPDATE bb_tables SET is_active = 0, name = CONCAT(name, '~', id) WHERE id = ?", [id]); // keep history, free the name
  else await q("DELETE FROM bb_tables WHERE id = ?", [id]);
  await audit(ctx, { action: "Deleted", module: "Tables", details: `Deleted table ${t.name}`, record_id: id, level: "warning" });
  return { message: "Table deleted." };
});

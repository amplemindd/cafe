"use strict";
const { api, q, one, fail, audit, notify, saveUpload, removeUpload, paging, like, str, num, r2, ymd, isYmd, getSettings, pool } = require("../lib/core");

api.get("/api/expense-categories", "auth", async () => ({ categories: await q("SELECT id, name FROM bb_expense_categories ORDER BY name") }));
api.post("/api/expense-categories", "expenses", async (ctx) => {
  const name = str(ctx.body.name, 80);
  if (!name) throw fail(400, "Category name is required.");
  if (await one("SELECT id FROM bb_expense_categories WHERE name = ?", [name])) throw fail(409, "This category already exists.");
  const r = (await pool.query("INSERT INTO bb_expense_categories (name) VALUES (?)", [name]))[0];
  return { __status: 201, id: r.insertId, message: "Expense category added." };
});

function where(Q) {
  const w = ["e.is_deleted = 0"], p = [];
  if (isYmd(Q.from)) { w.push("e.expense_date >= ?"); p.push(Q.from); }
  if (isYmd(Q.to)) { w.push("e.expense_date <= ?"); p.push(Q.to); }
  if (Q.category_id) { w.push("e.category_id = ?"); p.push(Number(Q.category_id)); }
  if (Q.payment_mode) { w.push("e.payment_mode = ?"); p.push(Q.payment_mode); }
  if (Q.added_by) { w.push("e.added_by = ?"); p.push(Number(Q.added_by)); }
  if (Q.q) { w.push("(e.name LIKE ? OR e.supplier LIKE ? OR e.notes LIKE ? OR c.name LIKE ?)"); p.push(like(Q.q), like(Q.q), like(Q.q), like(Q.q)); }
  return { w: w.join(" AND "), p };
}
const FROM = "FROM bb_expenses e JOIN bb_expense_categories c ON c.id = e.category_id LEFT JOIN bb_users u ON u.id = e.added_by";

api.get("/api/expenses", "expenses", async (ctx) => {
  const { w, p } = where(ctx.query), { limit, offset } = paging(ctx.query, 10);
  const [{ total }] = await q(`SELECT COUNT(*) total ${FROM} WHERE ${w}`, p);
  const rows = await q(`SELECT e.id, e.expense_date, e.category_id, c.name AS category, e.name, e.supplier, e.amount, e.payment_mode, e.notes, e.attachment, u.name AS added_by_name
    ${FROM} WHERE ${w} ORDER BY e.expense_date DESC, e.id DESC LIMIT ? OFFSET ?`, [...p, limit, offset]);
  return { expenses: rows, total };
});

api.get("/api/expenses/summary", "expenses", async (ctx) => {
  const { w, p } = where(ctx.query);
  const today = ymd(), month = today.slice(0, 7);
  const [t] = await q(`SELECT COALESCE(SUM(e.amount),0) total, COUNT(*) n, COUNT(DISTINCT e.expense_date) days ${FROM} WHERE ${w}`, p);
  const [m] = await q("SELECT COALESCE(SUM(amount),0) v FROM bb_expenses WHERE is_deleted=0 AND DATE_FORMAT(expense_date,'%Y-%m') = ?", [month]);
  const prev = new Date(); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
  const pm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  const [pmv] = await q("SELECT COALESCE(SUM(amount),0) v FROM bb_expenses WHERE is_deleted=0 AND DATE_FORMAT(expense_date,'%Y-%m') = ?", [pm]);
  const [td] = await q("SELECT COALESCE(SUM(amount),0) v FROM bb_expenses WHERE is_deleted=0 AND expense_date = ?", [today]);
  const trend = await q(`SELECT DATE_FORMAT(expense_date,'%Y-%m') k, SUM(amount) v FROM bb_expenses WHERE is_deleted=0 AND expense_date >= DATE_SUB(?, INTERVAL 11 MONTH) GROUP BY k ORDER BY k`, [`${month}-01`]);
  const byCat = await q(`SELECT c.name, SUM(e.amount) amount ${FROM} WHERE ${w} GROUP BY c.name ORDER BY amount DESC`, p);
  return { summary: { total: t.total, count: t.n, month: m.v, month_change: pmv.v ? ((m.v - pmv.v) / pmv.v) * 100 : 0, today: td.v, avg_daily: t.days ? r2(t.total / t.days) : 0 }, trend, by_category: byCat };
});

async function body(b, existing) {
  const name = str(b.name, 150), amount = num(b.amount, NaN), date = str(b.expense_date, 10), mode = str(b.payment_mode, 30);
  if (!isYmd(date)) throw fail(400, "Choose a valid date.");
  if (!name) throw fail(400, "Expense name is required.");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) throw fail(400, "Enter a valid amount greater than zero.");
  if (!mode) throw fail(400, "Select a payment mode.");
  if (!(await one("SELECT id FROM bb_expense_categories WHERE id = ?", [Number(b.category_id)]))) throw fail(400, "Select a category.");
  let attachment = existing ? existing.attachment : null;
  if (b.attachment_data) { attachment = saveUpload(b.attachment_data, { allowPdf: true, maxBytes: 5 * 1024 * 1024 }); if (existing) removeUpload(existing.attachment); }
  return { date, category_id: Number(b.category_id), name, supplier: str(b.supplier, 150) || null, amount: r2(amount), mode, notes: str(b.notes, 500) || null, attachment };
}

api.post("/api/expenses", "expenses", async (ctx) => {
  const v = await body(ctx.body), S = await getSettings();
  const r = (await pool.query("INSERT INTO bb_expenses (expense_date, category_id, name, supplier, amount, payment_mode, notes, attachment, added_by) VALUES (?,?,?,?,?,?,?,?,?)",
    [v.date, v.category_id, v.name, v.supplier, v.amount, v.mode, v.notes, v.attachment, ctx.user.id]))[0];
  await audit(ctx, { action: "Created", module: "Expenses", details: `Added expense "${v.name}" (₹${v.amount})`, record_id: r.insertId, neu: v });
  if (v.amount >= S.high_expense_threshold) await notify({ type: "expense", title: "High Expense Alert", message: `${v.name} (₹${v.amount}) added in expenses`, priority: "warning", link_type: "expense", link_id: r.insertId });
  return { __status: 201, id: r.insertId, message: "Expense saved." };
});

api.put("/api/expenses/:id", "expenses", async (ctx) => {
  const id = Number(ctx.params.id);
  const old = await one("SELECT * FROM bb_expenses WHERE id = ? AND is_deleted = 0", [id]);
  if (!old) throw fail(404, "Expense not found.");
  const v = await body(ctx.body, old);
  await q("UPDATE bb_expenses SET expense_date=?, category_id=?, name=?, supplier=?, amount=?, payment_mode=?, notes=?, attachment=? WHERE id=?", [v.date, v.category_id, v.name, v.supplier, v.amount, v.mode, v.notes, v.attachment, id]);
  await audit(ctx, { action: "Updated", module: "Expenses", details: `Updated expense "${v.name}" (₹${old.amount} → ₹${v.amount})`, record_id: id, old: { amount: old.amount, name: old.name }, neu: { amount: v.amount, name: v.name }, level: "warning" });
  return { message: "Expense updated." };
});

api.delete("/api/expenses/:id", "expenses", async (ctx) => {
  const id = Number(ctx.params.id);
  const old = await one("SELECT * FROM bb_expenses WHERE id = ? AND is_deleted = 0", [id]);
  if (!old) throw fail(404, "Expense not found.");
  await q("UPDATE bb_expenses SET is_deleted = 1 WHERE id = ?", [id]); // soft delete keeps the audit trail
  await audit(ctx, { action: "Deleted", module: "Expenses", details: `Deleted expense "${old.name}" (₹${old.amount})`, record_id: id, old: { amount: old.amount, name: old.name }, level: "critical" });
  return { message: "Expense deleted." };
});

"use strict";
// Dashboard + reports. Definitions (kept identical everywhere):
//   Sales      = bills with payment_status 'paid' that are not cancelled (grouped by payment date). Includes tax.
//   Net sales  = sales - tax collected.
//   Cancelled / refunded bills are never counted. Split payments are counted once per payment row.
//   Net profit (operational) = net sales - recorded expenses. It is NOT a full accounting profit.
const { api, q, fail, dateRange, ymd, r2, getSettings, notify, can } = require("../lib/core");

const rng = (ctx) => (ctx.user && ctx.user.public ? { from: ymd(), to: ymd() } : dateRange(ctx.query));
const PAID = "o.payment_status = 'paid' AND o.status <> 'cancelled'";
const pct = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

async function kpis(from, to) {
  const [s] = await q(`SELECT COUNT(*) orders, COALESCE(SUM(o.total),0) sales, COALESCE(SUM(o.tax_amount),0) tax, COALESCE(SUM(o.discount_amount),0) discount
    FROM bb_orders o WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ?`, [from, to]);
  const [e] = await q("SELECT COALESCE(SUM(amount),0) v FROM bb_expenses WHERE is_deleted = 0 AND expense_date BETWEEN ? AND ?", [from, to]);
  const [c] = await q("SELECT COUNT(*) n FROM bb_customers WHERE DATE(created_at) BETWEEN ? AND ?", [from, to]);
  const [tc] = await q(`SELECT COUNT(DISTINCT o.customer_id) n FROM bb_orders o WHERE ${PAID} AND o.customer_id IS NOT NULL AND DATE(o.paid_at) BETWEEN ? AND ?`, [from, to]);
  const net = r2(s.sales - s.tax);
  return { orders: s.orders, sales: s.sales, tax: s.tax, discount: s.discount, net_sales: net, avg_bill: s.orders ? r2(s.sales / s.orders) : 0,
    expenses: e.v, profit: r2(net - e.v), new_customers: c.n, customers: tc.n };
}

async function overview(from, to) {
  const len = diffDays(from, to) + 1, pTo = addDays(from, -1), pFrom = addDays(pTo, -(len - 1));
  const cur = await kpis(from, to), prev = await kpis(pFrom, pTo);
  const change = {}; for (const k of ["orders", "sales", "avg_bill", "new_customers", "customers", "expenses", "profit"]) change[k] = r2(pct(cur[k], prev[k]));

  // trend: hourly for a single day, daily otherwise
  let series;
  if (len === 1) {
    const rows = await q(`SELECT HOUR(o.paid_at) k, COUNT(*) orders, SUM(o.total) sales FROM bb_orders o WHERE ${PAID} AND DATE(o.paid_at) = ? GROUP BY k`, [from]);
    const m = new Map(rows.map((r) => [r.k, r]));
    series = { mode: "hour", points: Array.from({ length: 16 }, (_, i) => { const h = i + 8, r = m.get(h); const lab = h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`; return { label: lab, sales: r ? r.sales : 0, orders: r ? r.orders : 0 }; }) };
  } else {
    const rows = await q(`SELECT DATE(o.paid_at) k, COUNT(*) orders, SUM(o.total) sales FROM bb_orders o WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY k`, [from, to]);
    const m = new Map(rows.map((r) => [String(r.k).slice(0, 10), r]));
    const pts = []; for (let i = 0; i < Math.min(len, 92); i++) { const d = addDays(from, i), r = m.get(d); pts.push({ label: d.slice(8) + " " + new Date(d + "T00:00:00Z").toLocaleString("en", { month: "short", timeZone: "UTC" }), date: d, sales: r ? r.sales : 0, orders: r ? r.orders : 0 }); }
    series = { mode: "day", points: pts };
  }
  const hourlyRows = await q(`SELECT HOUR(o.paid_at) k, SUM(o.total) sales FROM bb_orders o WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY k`, [from, to]);
  const hm = new Map(hourlyRows.map((r) => [r.k, r.sales]));
  const hourly = Array.from({ length: 15 }, (_, i) => { const h = i + 8; return { label: h === 12 ? "12PM" : h > 12 ? `${h - 12}PM` : `${h}AM`, sales: hm.get(h) || 0 }; });

  const types = await q(`SELECT o.order_type k, COUNT(*) n, SUM(o.total) amount FROM bb_orders o WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY k`, [from, to]);
  const payments = await q(`SELECT p.method k, COUNT(*) n, SUM(p.amount) amount FROM bb_payments p JOIN bb_orders o ON o.id = p.order_id WHERE ${PAID} AND p.status = 'paid' AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY k`, [from, to]);
  const top = await q(`SELECT i.product_name name, COUNT(DISTINCT i.order_id) orders, SUM(i.qty) qty, SUM(i.line_total) sales
    FROM bb_order_items i JOIN bb_orders o ON o.id = i.order_id WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY i.product_name ORDER BY qty DESC, sales DESC LIMIT 7`, [from, to]);
  if (top.length) {
    const imgs = await q("SELECT name, image_url FROM products WHERE name IN (?) AND is_archived = 0", [top.map((t) => t.name)]);
    const im = new Map(imgs.map((x) => [x.name, x.image_url]));
    top.forEach((t) => (t.image_url = im.get(t.name) || ""));
  }
  const cats = await q(`SELECT COALESCE(i.category_name,'Others') name, COUNT(DISTINCT i.order_id) orders, SUM(i.qty) qty, SUM(i.line_total) sales
    FROM bb_order_items i JOIN bb_orders o ON o.id = i.order_id WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY name ORDER BY sales DESC LIMIT 10`, [from, to]);
  const summary = await q(`SELECT DATE(o.paid_at) date, COUNT(*) orders, SUM(o.total) sales, ROUND(SUM(o.total)/COUNT(*),2) avg_bill
    FROM bb_orders o WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY DATE(o.paid_at) ORDER BY date DESC LIMIT 10`, [from, to]);
  const nc = new Map((await q("SELECT DATE(created_at) d, COUNT(*) n FROM bb_customers WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY d", [from, to])).map((r) => [String(r.d).slice(0, 10), r.n]));
  summary.forEach((r) => (r.new_customers = nc.get(String(r.date).slice(0, 10)) || 0));
  const recent = await q(`SELECT o.id, o.bill_no, o.created_at, o.table_name, o.order_type, o.total, o.status, o.payment_status, o.customer_name,
    (SELECT GROUP_CONCAT(DISTINCT method) FROM bb_payments WHERE order_id = o.id) methods,
    (SELECT COALESCE(SUM(qty),0) FROM bb_order_items WHERE order_id = o.id) items FROM bb_orders o ORDER BY o.id DESC LIMIT 8`);

  // weekly sales / expenses / profit buckets
  const dSales = await q(`SELECT DATE(o.paid_at) d, SUM(o.total - o.tax_amount) v FROM bb_orders o WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY d`, [from, to]);
  const dExp = await q("SELECT expense_date d, SUM(amount) v FROM bb_expenses WHERE is_deleted = 0 AND expense_date BETWEEN ? AND ? GROUP BY d", [from, to]);
  const weeks = Math.min(Math.ceil(len / 7), 6), wk = Array.from({ length: weeks }, (_, i) => ({ label: `Week ${i + 1}`, sales: 0, expenses: 0, profit: 0 }));
  for (const r of dSales) { const i = Math.min(Math.floor(diffDays(from, String(r.d).slice(0, 10)) / 7), weeks - 1); wk[i].sales += r.v; }
  for (const r of dExp) { const i = Math.min(Math.floor(diffDays(from, String(r.d).slice(0, 10)) / 7), weeks - 1); wk[i].expenses += r.v; }
  wk.forEach((w) => { w.sales = r2(w.sales); w.expenses = r2(w.expenses); w.profit = r2(w.sales - w.expenses); });

  return { range: { from, to, days: len }, kpis: cur, change, series, hourly, types, payments, top, cats, summary, recent, weekly: wk };
}

api.get("/api/reports/overview", "reports", async (ctx) => { const { from, to } = rng(ctx); return await overview(from, to); });

api.get("/api/dashboard", "reports", async (ctx) => {
  const { from, to } = rng(ctx), today = ymd(), mStart = today.slice(0, 8) + "01";
  const ov = await overview(from, to);
  const month = await kpis(mStart, today);
  const exp = await q("SELECT c.name, SUM(e.amount) amount FROM bb_expenses e JOIN bb_expense_categories c ON c.id = e.category_id WHERE e.is_deleted = 0 AND e.expense_date BETWEEN ? AND ? GROUP BY c.name ORDER BY amount DESC", [mStart, today]);
  const last7 = await q(`SELECT DATE(o.paid_at) d, SUM(o.total) sales, COUNT(*) orders FROM bb_orders o WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY d`, [addDays(today, -6), today]);
  const m7 = new Map(last7.map((r) => [String(r.d).slice(0, 10), r]));
  const bars = Array.from({ length: 7 }, (_, i) => { const d = addDays(today, i - 6), r = m7.get(d); return { label: d.slice(8) + " " + new Date(d + "T00:00:00Z").toLocaleString("en", { month: "short", timeZone: "UTC" }), sales: r ? r.sales : 0, orders: r ? r.orders : 0 }; });
  const tables = await q(`SELECT t.id, t.name, t.capacity, t.status, o.id order_id, o.bill_no, o.total order_total, o.guests, TIME_FORMAT(o.created_at,'%h:%i %p') since, t.reserved_for, TIME_FORMAT(t.reserved_at,'%h:%i %p') reserved_time
    FROM bb_tables t LEFT JOIN bb_orders o ON o.table_id = t.id AND o.payment_status='unpaid' AND o.status NOT IN ('cancelled','completed') WHERE t.is_active = 1 ORDER BY t.sort_order, t.id`);
  tables.forEach((t) => { if (t.order_id) t.status = "occupied"; else if (t.status === "occupied") t.status = "available"; });
  const notifications = await q("SELECT id, type, title, message, priority, link_type, link_id, is_read, created_at FROM bb_notifications WHERE is_archived = 0 ORDER BY id DESC LIMIT 5");
  await dailyReportNotice();
  return { ...ov, month: { ...month, expense_breakdown: exp }, last7: bars, tables, notifications };
});

// "daily report ready" notification, created once per day (deduplicated)
async function dailyReportNotice() {
  const y = addDays(ymd(), -1);
  const [r] = await q(`SELECT COUNT(*) n FROM bb_orders o WHERE ${PAID} AND DATE(o.paid_at) = ?`, [y]);
  if (r.n) await notify({ type: "report", title: "Daily Report Ready", message: `Daily sales report for ${y} is ready to view`, link_type: "report", link_id: "daily", dedupe: `daily-${y}` });
}

/* ---------- detailed reports ---------- */
const col = (key, label, fmt = "text") => ({ key, label, fmt });
const REPORTS = {
  sales: async (from, to) => ({ title: "Sales Report", columns: [col("date", "Date", "date"), col("orders", "Orders", "int"), col("gross", "Gross Sales", "money"), col("discount", "Discount", "money"), col("tax", "Tax", "money"), col("net", "Net Sales", "money"), col("total", "Total (Incl. Tax)", "money")],
    rows: await q(`SELECT DATE(o.paid_at) date, COUNT(*) orders, SUM(o.subtotal) gross, SUM(o.discount_amount) discount, SUM(o.tax_amount) tax, SUM(o.total - o.tax_amount) net, SUM(o.total) total
      FROM bb_orders o WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY DATE(o.paid_at) ORDER BY date DESC`, [from, to]) }),
  orders: async (from, to) => ({ title: "Order Report", columns: [col("bill_no", "Bill No"), col("created_at", "Date & Time", "datetime"), col("order_type", "Type", "type"), col("table_name", "Table"), col("customer_name", "Customer"), col("items", "Items", "int"), col("total", "Total", "money"), col("payment_status", "Payment", "cap"), col("status", "Status", "cap")],
    rows: await q(`SELECT o.bill_no, o.created_at, o.order_type, o.table_name, o.customer_name, o.total, o.payment_status, o.status, (SELECT COALESCE(SUM(qty),0) FROM bb_order_items WHERE order_id = o.id) items
      FROM bb_orders o WHERE DATE(o.created_at) BETWEEN ? AND ? ORDER BY o.id DESC LIMIT 5000`, [from, to]) }),
  items: async (from, to) => ({ title: "Item Report", columns: [col("name", "Item"), col("category", "Category"), col("orders", "Orders", "int"), col("qty", "Quantity", "int"), col("sales", "Sales", "money")],
    rows: await q(`SELECT i.product_name name, COALESCE(i.category_name,'-') category, COUNT(DISTINCT i.order_id) orders, SUM(i.qty) qty, SUM(i.line_total) sales
      FROM bb_order_items i JOIN bb_orders o ON o.id = i.order_id WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY i.product_name, category ORDER BY qty DESC`, [from, to]) }),
  payments: async (from, to) => {
    const rows = await q(`SELECT p.method, COUNT(*) txns, SUM(p.amount) amount FROM bb_payments p JOIN bb_orders o ON o.id = p.order_id WHERE ${PAID} AND p.status='paid' AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY p.method ORDER BY amount DESC`, [from, to]);
    const tot = rows.reduce((s, r) => s + r.amount, 0); rows.forEach((r) => (r.share = tot ? r2((r.amount / tot) * 100) : 0));
    return { title: "Payment Report", columns: [col("method", "Method", "cap"), col("txns", "Transactions", "int"), col("amount", "Amount", "money"), col("share", "Share", "pct")], rows };
  },
  taxes: async (from, to) => ({ title: "Tax Report", columns: [col("rate", "Tax Rate", "pct"), col("taxable", "Taxable Value", "money"), col("cgst", "CGST", "money"), col("sgst", "SGST", "money"), col("tax", "Total Tax", "money")],
    rows: (await q(`SELECT i.tax_rate rate, SUM(i.taxable) taxable, SUM(i.tax_amount) tax FROM bb_order_items i JOIN bb_orders o ON o.id = i.order_id WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY i.tax_rate ORDER BY rate`, [from, to]))
      .map((r) => ({ ...r, taxable: r2(r.taxable), tax: r2(r.tax), cgst: r2(r.tax / 2), sgst: r2(r.tax / 2) })) }),
  expenses: async (from, to) => {
    const rows = await q("SELECT c.name category, COUNT(*) entries, SUM(e.amount) amount FROM bb_expenses e JOIN bb_expense_categories c ON c.id = e.category_id WHERE e.is_deleted = 0 AND e.expense_date BETWEEN ? AND ? GROUP BY c.name ORDER BY amount DESC", [from, to]);
    const tot = rows.reduce((s, r) => s + r.amount, 0); rows.forEach((r) => (r.share = tot ? r2((r.amount / tot) * 100) : 0));
    return { title: "Expense Report", columns: [col("category", "Category"), col("entries", "Entries", "int"), col("amount", "Amount", "money"), col("share", "Share", "pct")], rows };
  },
  "profit-loss": async (from, to) => {
    const s = await q(`SELECT DATE(o.paid_at) d, SUM(o.total) gross, SUM(o.tax_amount) tax FROM bb_orders o WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY d`, [from, to]);
    const e = await q("SELECT expense_date d, SUM(amount) v FROM bb_expenses WHERE is_deleted = 0 AND expense_date BETWEEN ? AND ? GROUP BY d", [from, to]);
    const map = {};
    for (const r of s) map[String(r.d).slice(0, 10)] = { date: String(r.d).slice(0, 10), sales: r.gross, tax: r.tax, expenses: 0 };
    for (const r of e) { const k = String(r.d).slice(0, 10); (map[k] ||= { date: k, sales: 0, tax: 0, expenses: 0 }).expenses += r.v; }
    const rows = Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1)).map((r) => ({ ...r, net: r2(r.sales - r.tax), profit: r2(r.sales - r.tax - r.expenses) }));
    return { title: "Profit & Loss", note: "Operational profit = Sales (excluding tax) − recorded expenses. It is not a full accounting profit.", columns: [col("date", "Date", "date"), col("sales", "Sales (Incl. Tax)", "money"), col("tax", "Tax Collected", "money"), col("net", "Net Sales", "money"), col("expenses", "Expenses", "money"), col("profit", "Profit", "money")], rows };
  },
  daily: async (from, to) => {
    const rows = await q(`SELECT DATE(o.paid_at) date, COUNT(*) orders, SUM(o.total) sales, ROUND(SUM(o.total)/COUNT(*),2) avg_bill
      FROM bb_orders o WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY DATE(o.paid_at) ORDER BY date DESC`, [from, to]);
    const nc = new Map((await q("SELECT DATE(created_at) d, COUNT(*) n FROM bb_customers WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY d", [from, to])).map((r) => [String(r.d).slice(0, 10), r.n]));
    const ex = new Map((await q("SELECT expense_date d, SUM(amount) v FROM bb_expenses WHERE is_deleted = 0 AND expense_date BETWEEN ? AND ? GROUP BY d", [from, to])).map((r) => [String(r.d).slice(0, 10), r.v]));
    rows.forEach((r) => { const k = String(r.date).slice(0, 10); r.new_customers = nc.get(k) || 0; r.expenses = ex.get(k) || 0; });
    return { title: "Daily Report", columns: [col("date", "Date", "date"), col("orders", "Orders", "int"), col("sales", "Sales", "money"), col("avg_bill", "Avg. Bill", "money"), col("new_customers", "New Customers", "int"), col("expenses", "Expenses", "money")], rows };
  },
  monthly: async (from, to) => {
    const rows = await q(`SELECT DATE_FORMAT(o.paid_at,'%Y-%m') month, COUNT(*) orders, SUM(o.total) sales, SUM(o.tax_amount) tax FROM bb_orders o WHERE ${PAID} AND DATE(o.paid_at) BETWEEN ? AND ? GROUP BY month ORDER BY month DESC`, [from, to]);
    const ex = await q("SELECT DATE_FORMAT(expense_date,'%Y-%m') month, SUM(amount) v FROM bb_expenses WHERE is_deleted = 0 AND expense_date BETWEEN ? AND ? GROUP BY month", [from, to]);
    const em = new Map(ex.map((r) => [r.month, r.v]));
    rows.forEach((r) => { r.expenses = em.get(r.month) || 0; r.profit = r2(r.sales - r.tax - r.expenses); r.avg_bill = r.orders ? r2(r.sales / r.orders) : 0; });
    return { title: "Monthly Report", columns: [col("month", "Month"), col("orders", "Orders", "int"), col("sales", "Sales", "money"), col("avg_bill", "Avg. Bill", "money"), col("expenses", "Expenses", "money"), col("profit", "Profit", "money")], rows };
  },
};

api.get("/api/reports/:name", "reports", async (ctx) => {
  const fn = REPORTS[ctx.params.name];
  if (!fn) throw fail(404, "Unknown report.");
  let { from, to } = rng(ctx);
  if (ctx.params.name === "monthly" && !ctx.query.from) { const t = ymd(); from = addDays(t.slice(0, 8) + "01", -330); to = t; }
  return { report: await fn(from, to), range: { from, to } };
});

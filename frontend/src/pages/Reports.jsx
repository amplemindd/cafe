import React, { useState } from "react";
import { cap, fmtDate, fmtDT, fmtTime, money, num, preset, saveCSV, TYPES } from "../lib/api";
import { useAuth, useFetch, useUI } from "../lib/store";
import { Badge, ErrorBox, Loading, Panel, RangePicker, Stat, Empty } from "../lib/ui";
import { Bars, Combo, Donut, GroupBars } from "../lib/charts";
import { REPORT_LINKS } from "../components/Shell";

const TCOL = { dine_in: "#14532D", pickup: "#2563EB", delivery: "#D97706", online: "#9333EA" };
const PCOL = { cash: "#15803D", upi: "#2563EB", card: "#D97706", wallet: "#9333EA" };

export default function Reports() {
  const { user } = useAuth();
  const pub = !!user.public;
  const [r, setR] = useState(preset(pub ? "today" : "month"));
  const d = useFetch("/reports/overview", r, [], 30000);
  if (d.error && !d.data) return <div className="page"><ErrorBox msg={d.error} retry={d.reloadFull} /></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const x = d.data, k = x.kpis, ch = x.change, totT = x.types.reduce((s, t) => s + t.n, 0), totP = x.payments.reduce((s, t) => s + t.amount, 0);
  const catTotal = x.cats.reduce((s, c) => s + c.sales, 0);
  const exportCsv = () => saveCSV(`sales-summary-${x.range.from}.csv`, x.summary, [{ label: "Date", get: (s) => fmtDate(s.date) }, { label: "Total Orders", key: "orders" }, { label: "Total Sales", key: "sales" }, { label: "Avg. Bill", key: "avg_bill" }, { label: "New Customers", key: "new_customers" }]);
  return (
    <div className="page">
      <div className="ph"><div><h1>Reports</h1><p className="muted">{pub ? "Today's sales, orders and menu performance" : "Analyse your sales, orders, customers and business performance"}</p></div>
        <div className="row-end">{pub ? <span className="badge green">Showing today only</span> : <RangePicker {...r} onChange={setR} />}<button className="btn" onClick={exportCsv}>⭳ Export</button><button className="btn pri" onClick={() => window.print()}>🖨 Print Report</button></div></div>
      <div className="kpis k6">
        <Stat icon="₹" label="Total Sales" value={money(k.sales)} delta={ch.sales} sub="vs. previous" />
        <Stat icon="🛒" label="Total Orders" value={num(k.orders)} delta={ch.orders} sub="vs. previous" tone="amber" />
        <Stat icon="🧮" label="Average Bill Value" value={money(k.avg_bill)} delta={ch.avg_bill} sub="vs. previous" tone="purple" />
        {pub ? <Stat icon="🙋" label="New Customers" value={num(k.new_customers)} delta={ch.new_customers} sub="vs. previous" tone="blue" /> : <>
          <Stat icon="👥" label="Total Customers" value={num(k.customers)} delta={ch.customers} sub="vs. previous" tone="blue" />
          <Stat icon="💸" label="Total Expenses" value={money(k.expenses)} delta={ch.expenses} sub="vs. previous" tone="red" />
          <Stat icon="📈" label="Net Profit" value={money(k.profit)} delta={ch.profit} sub="vs. previous" /></>}
      </div>
      <div className="g3">
        <Panel title="Sales Trend" className="span2"><div className="lg"><i style={{ background: "#14532D" }} /> Sales (₹) <i style={{ background: "#86EFAC" }} /> Orders</div><Combo points={x.series.points} /></Panel>
        <Panel title="Order Type Distribution"><Donut center={{ big: totT, small: "Total Orders" }} data={x.types.map((t) => ({ label: TYPES[t.k] || t.k, value: t.n, text: `${t.n} (${totT ? Math.round((t.n / totT) * 100) : 0}%)`, color: TCOL[t.k] }))} /></Panel>
        <Panel title="Payment Method"><Donut center={{ big: money(totP), small: "Total Sales" }} data={x.payments.map((t) => ({ label: cap(t.k), value: t.amount, text: `${totP ? Math.round((t.amount / totP) * 100) : 0}%`, color: PCOL[t.k] }))} /></Panel>
      </div>
      <div className="g3b">
        <Panel title="Top Selling Items" pad={false}><table className="tbl sm"><thead><tr><th>#</th><th>Item</th><th>Orders</th><th>Qty</th><th>Sales</th></tr></thead><tbody>{x.top.map((t, i) => <tr key={t.name}><td>{i + 1}</td><td>{t.name}</td><td>{t.orders}</td><td>{t.qty}</td><td>{money(t.sales)}</td></tr>)}</tbody></table>{!x.top.length && <p className="muted pad">No sales in this period.</p>}</Panel>
        <Panel title="Category Wise Sales">{pub || x.cats.length <= 8 ? <Bars data={x.cats.slice(0, 7).map((c) => ({ label: c.name.slice(0, 9), value: c.sales }))} fmt={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : num(v))} /> : null}
          {!pub && <table className="tbl sm"><thead><tr><th>Category</th><th>Sales</th><th>Orders</th><th>%</th></tr></thead><tbody>{x.cats.map((c) => <tr key={c.name}><td>{c.name}</td><td>{money(c.sales)}</td><td>{c.orders}</td><td>{catTotal ? Math.round((c.sales / catTotal) * 100) : 0}%</td></tr>)}</tbody></table>}</Panel>
        <Panel title="Hourly Sales"><Bars data={x.hourly.map((h) => ({ label: h.label, value: h.sales }))} fmt={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : num(v))} /></Panel>
      </div>
      <div className="g2">
        <Panel title="Sales Summary" pad={false}><div className="table-wrap"><table className="tbl sm"><thead><tr><th>Date</th><th>Orders</th><th>Sales</th><th>Avg. Bill</th><th>New Customers</th></tr></thead>
          <tbody>{x.summary.map((s) => <tr key={String(s.date)}><td>{fmtDate(s.date)}</td><td>{s.orders}</td><td>{money(s.sales)}</td><td>{money(s.avg_bill)}</td><td>{s.new_customers}</td></tr>)}</tbody></table>{!x.summary.length && <p className="muted pad">No sales in this period.</p>}</div></Panel>
        <Panel title="Recent Orders" pad={false}><div className="table-wrap"><table className="tbl sm"><thead><tr><th>#</th><th>Time</th><th>Table</th><th>Type</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead>
          <tbody>{x.recent.map((o) => <tr key={o.id}><td>{o.bill_no}</td><td>{fmtTime(o.created_at)}</td><td>{o.table_name || "-"}</td><td>{TYPES[o.order_type]}</td><td>{o.items}</td><td>{money(o.total)}</td><td><Badge v={o.payment_status} /></td><td><Badge v={o.status} /></td></tr>)}</tbody></table>{!x.recent.length && <p className="muted pad">No orders yet.</p>}</div></Panel>
      </div>
      {!pub && <Panel title="Expenses vs Profit"><div className="lg"><i style={{ background: "#14532D" }} /> Sales <i style={{ background: "#D97706" }} /> Expenses <i style={{ background: "#22C55E" }} /> Profit</div><GroupBars data={x.weekly} keys={["sales", "expenses", "profit"]} colors={["#14532D", "#D97706", "#22C55E"]} />
        <div className="mini-stats"><div><small>Sales (excl. tax)</small><b>{money(k.net_sales)}</b></div><div><small>Expenses</small><b>{money(k.expenses)}</b></div><div><small>Net Profit</small><b>{money(k.profit)}</b></div></div></Panel>}
    </div>
  );
}

const FMT = { money: (v) => money(v), int: (v) => num(v), pct: (v) => `${v}%`, date: (v) => fmtDate(v), datetime: (v) => fmtDT(v), type: (v) => TYPES[v] || v, cap: (v) => cap(v), text: (v) => v ?? "-" };

export function ReportDetail({ name }) {
  const { toast } = useUI();
  const [r, setR] = useState(preset(name === "daily" ? "today" : "month"));
  const [dr, setDr] = useState(name === "monthly" ? null : r);
  const d = useFetch(`/reports/${name}`, name === "monthly" && !dr ? {} : dr);
  const rep = d.data?.report;
  const exp = () => saveCSV(`${name}-report.csv`, rep.rows, rep.columns.map((c) => ({ label: c.label, get: (row) => (FMT[c.fmt] || FMT.text)(row[c.key]) })));
  const totals = rep && rep.columns.filter((c) => ["money", "int"].includes(c.fmt) && rep.rows.length > 1).map((c) => [c.key, rep.rows.reduce((s, row) => s + (Number(row[c.key]) || 0), 0)]);
  return (
    <div className="page">
      <div className="ph"><div><h1>{rep?.title || cap(name)}</h1><p className="muted">{d.data ? `${fmtDate(d.data.range.from)} – ${fmtDate(d.data.range.to)}` : ""}</p></div>
        <div className="row-end"><RangePicker {...(dr || r)} onChange={(v) => { setR(v); setDr(v); }} /><button className="btn" disabled={!rep} onClick={() => { try { exp(); } catch (e) { toast(e.message, "err"); } }}>⭳ Export</button><button className="btn pri" onClick={() => window.print()}>🖨 Print</button></div></div>
      <div className="subtabs">{REPORT_LINKS.map(([n, l]) => <a key={n} href={`/admin/reports/${n}`} className={n === name ? "on" : ""} onClick={(e) => { e.preventDefault(); window.history.pushState({}, "", `/admin/reports/${n}`); window.dispatchEvent(new Event("bbnav")); }}>{l}</a>)}</div>
      {d.error && !rep ? <ErrorBox msg={d.error} retry={d.reloadFull} /> : !rep ? <Loading /> : (
        <section className="card">
          {rep.note && <p className="note pad">{rep.note}</p>}
          {!rep.rows.length ? <Empty icon="📊" text="No data for this period." /> : (
            <div className="table-wrap"><table className="tbl"><thead><tr>{rep.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>{rep.rows.map((row, i) => <tr key={i}>{rep.columns.map((c) => <td key={c.key}>{c.key === "status" || c.key === "payment_status" ? <Badge v={row[c.key]} /> : (FMT[c.fmt] || FMT.text)(row[c.key])}</td>)}</tr>)}</tbody>
              {totals.length > 0 && <tfoot><tr>{rep.columns.map((c, i) => { const t = totals.find((x) => x[0] === c.key); return <td key={c.key}><b>{i === 0 ? "Total" : t ? (FMT[c.fmt])(t[1]) : ""}</b></td>; })}</tr></tfoot>}</table></div>
          )}
        </section>
      )}
    </div>
  );
}

import React, { useState } from "react";
import { cap, fmtDate, fmtTime, money, num, preset, TYPES, img } from "../lib/api";
import { A, navigate, useFetch } from "../lib/store";
import { Badge, ErrorBox, Loading, Panel, RangePicker, Stat } from "../lib/ui";
import { Bars, Combo, Donut } from "../lib/charts";

const TCOL = { dine_in: "#14532D", pickup: "#2563EB", delivery: "#D97706", online: "#9333EA" };
const PCOL = { cash: "#15803D", upi: "#2563EB", card: "#D97706", wallet: "#9333EA" };
const NICON = { order: "🛒", payment: "💳", inventory: "📦", table: "🪑", customer: "👤", expense: "⚠️", report: "📅", system: "⚙️" };

export default function Dashboard() {
  const [r, setR] = useState(preset("today"));
  const [bars, setBars] = useState("daily");
  const d = useFetch("/dashboard", r, [], 30000);
  if (d.error && !d.data) return <div className="page"><ErrorBox msg={d.error} retry={d.reloadFull} /></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const x = d.data, k = x.kpis, ch = x.change, totT = x.types.reduce((s, t) => s + t.n, 0), totP = x.payments.reduce((s, t) => s + t.amount, 0);
  const tc = (s) => x.tables.filter((t) => t.status === s).length;
  const barData = bars === "daily" ? x.last7.map((b) => ({ label: b.label.slice(0, 5), value: b.sales })) : x.weekly.map((w) => ({ label: w.label, value: w.sales }));
  return (
    <div className="page dash">
      <div className="ph"><div><h1>Dashboard</h1><p className="muted">Live overview of your café · {fmtDate(x.range.from)}{x.range.from !== x.range.to ? ` – ${fmtDate(x.range.to)}` : ""}</p></div><RangePicker {...r} onChange={setR} /></div>
      <div className="kpis">
        <Stat icon="🛒" label="Total Orders" value={num(k.orders)} delta={ch.orders} sub="vs. previous period" tone="amber" />
        <Stat icon="₹" label="Total Sales" value={money(k.sales)} delta={ch.sales} sub="vs. previous period" />
        <Stat icon="👥" label="New Customers" value={num(k.new_customers)} delta={ch.new_customers} sub="vs. previous period" tone="blue" />
        <Stat icon="🧮" label="Average Bill Value" value={money(k.avg_bill)} delta={ch.avg_bill} sub="vs. previous period" tone="purple" />
      </div>
      <div className="g3">
        <Panel title="Sales & Orders" className="span2" right={<span className="muted">{x.series.mode === "hour" ? "Hourly" : "Daily"}</span>}><div className="lg"><i style={{ background: "#14532D" }} /> Sales (₹) <i style={{ background: "#86EFAC" }} /> Orders</div><Combo points={x.series.points} /></Panel>
        <Panel title="Order Type Distribution"><Donut center={{ big: totT, small: "Total Orders" }} data={x.types.map((t) => ({ label: TYPES[t.k] || t.k, value: t.n, text: `${t.n} (${totT ? Math.round((t.n / totT) * 100) : 0}%)`, color: TCOL[t.k] }))} /></Panel>
        <Panel title="Payment Summary"><Donut center={{ big: money(totP), small: "Total Sales" }} data={x.payments.map((t) => ({ label: cap(t.k), value: t.amount, text: `${totP ? Math.round((t.amount / totP) * 100) : 0}%`, color: PCOL[t.k] }))} /></Panel>
      </div>
      <div className="g3b">
        <Panel title="Table Status" right={<A to="/admin/tables" className="lnk">View All</A>}>
          <div className="lg"><i style={{ background: "#15803D" }} /> Available ({tc("available")}) <i style={{ background: "#DC2626" }} /> Occupied ({tc("occupied")}) <i style={{ background: "#D97706" }} /> Reserved ({tc("reserved")}) <i style={{ background: "#2563EB" }} /> Cleaning ({tc("cleaning")})</div>
          <div className="mtiles">{x.tables.map((t) => <button key={t.id} className={`mt ${t.status}`} onClick={() => navigate("/admin/tables")} title={cap(t.status)}><b>{t.name}</b><small>{t.order_id ? `${t.bill_no} · ${money(t.order_total)}` : t.status === "reserved" ? t.reserved_time || "Reserved" : cap(t.status)}</small></button>)}</div>
        </Panel>
        <Panel title="Recent Orders" right={<A to="/admin/orders" className="lnk">View All</A>} pad={false}><div className="table-wrap"><table className="tbl sm"><thead><tr><th>#</th><th>Time</th><th>Table</th><th>Type</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>{x.recent.map((o) => <tr key={o.id} onClick={() => navigate("/admin/orders", { openId: o.id })}><td>{o.bill_no}</td><td>{fmtTime(o.created_at)}</td><td>{o.table_name || "-"}</td><td>{TYPES[o.order_type]}</td><td>{money(o.total)}</td><td><Badge v={o.status} /></td></tr>)}</tbody></table>{!x.recent.length && <p className="muted pad">No orders yet.</p>}</div></Panel>
        <Panel title="Notifications" right={<A to="/admin/notifications" className="lnk">View All</A>}>
          {x.notifications.map((n) => <div className="nrow" key={n.id}><span className="dd-ic">{NICON[n.type] || "🔔"}</span><div><b>{n.title}</b><small>{n.message}</small></div>{!n.is_read && <i className="udot" />}</div>)}
          {!x.notifications.length && <p className="muted">No notifications.</p>}</Panel>
      </div>
      <div className="g3b">
        <Panel title="Top Selling Products" right={<A to="/admin/reports/items" className="lnk">View All</A>} pad={false}><table className="tbl sm"><thead><tr><th>#</th><th>Item</th><th>Orders</th><th>Sales</th></tr></thead>
          <tbody>{x.top.slice(0, 5).map((t, i) => <tr key={t.name}><td>{i + 1}</td><td><span className="mini">{t.image_url ? <img src={img(t.image_url)} alt="" /> : "☕"}</span> {t.name}</td><td>{t.orders}</td><td>{money(t.sales)}</td></tr>)}</tbody></table>{!x.top.length && <p className="muted pad">No sales yet.</p>}</Panel>
        <Panel title="Daily / Monthly Reports" right={<A to="/admin/reports/daily" className="btn pri sm">View Report</A>}>
          <div className="tabs"><button className={`tab ${bars === "daily" ? "on" : ""}`} onClick={() => setBars("daily")}>Last 7 days</button><button className={`tab ${bars === "weekly" ? "on" : ""}`} onClick={() => setBars("weekly")}>By week</button></div>
          <Bars data={barData} fmt={(v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : num(v))} highlight="last" height={190} /></Panel>
        <Panel title="Expenses & Profit" right={<span className="muted">This month</span>}>
          <div className="mini-stats"><div className="g"><small>Total Sales</small><b>{money(x.month.sales)}</b></div><div className="r"><small>Total Expenses</small><b>{money(x.month.expenses)}</b></div><div className="b"><small>Net Profit</small><b>{money(x.month.profit)}</b></div></div>
          <table className="tbl sm"><thead><tr><th>Expense Category</th><th>Amount</th></tr></thead><tbody>{x.month.expense_breakdown.slice(0, 5).map((e) => <tr key={e.name}><td>{e.name}</td><td>{money(e.amount)}</td></tr>)}</tbody></table>
          {!x.month.expense_breakdown.length && <p className="muted">No expenses recorded this month.</p>}<p className="note">Net profit = sales (excluding tax) − recorded expenses.</p></Panel>
      </div>
    </div>
  );
}

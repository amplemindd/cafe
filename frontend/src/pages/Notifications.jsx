import React, { useEffect, useState } from "react";
import { api, ago, fmtDT, ymd } from "../lib/api";
import { navigate, useAuth, useDebounced, useFetch, useShell, useUI } from "../lib/store";
import { Badge, Empty, ErrorBox, Loading, Menu, Pager, Panel, Toggle } from "../lib/ui";
import { Bars } from "../lib/charts";

const TYPES = [["all", "All", "🔔"], ["order", "Orders", "🛒"], ["inventory", "Inventory", "📦"], ["payment", "Payments", "💳"], ["table", "Tables", "🪑"], ["customer", "Customers", "👤"], ["expense", "Expenses", "💸"], ["report", "Reports", "📅"], ["system", "System", "⚙️"]];
const LINK = { order: "/admin/orders", table: "/admin/tables", product: "/admin/menu", customer: "/admin/customers", report: "/admin/reports/daily", expense: "/admin/expenses" };
const PREFS = [["n_new_order", "New Orders", "Get notified for new orders"], ["n_low_stock", "Low Stock Alerts", "Get notified when items are low in stock"], ["n_payment", "Payment Updates", "Get notified for payment status changes"], ["n_table", "Table Alerts", "Reservations and table updates"], ["n_expense", "Expense Alerts", "High expense warnings"], ["n_daily_report", "Daily Reports", "Get notified when the daily report is ready"], ["n_system", "System Notifications", "System updates and changes"]];

export default function Notifications() {
  const { settings: S, refresh } = useAuth();
  const { toast } = useUI();
  const { search, reload } = useShell();
  const [f, setF] = useState({ type: "all", status: "all", time: "all" });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(null);
  const dq = useDebounced(search);
  const d = useFetch("/notifications", { ...f, q: dq, page, limit: 10 }, [], 20000);
  useEffect(() => setPage(1), [f, dq]);
  const data = d.data, ub = data?.unread_by_type || {};
  const done = () => { d.reload(); reload(); };
  const read = async (n) => { if (!n.is_read) { await api(`/notifications/${n.id}/read`, { method: "PATCH" }).catch(() => {}); done(); } };
  const open = (n) => { setSel({ ...n, is_read: 1 }); read(n); };
  const readAll = async () => { try { const r = await api("/notifications/read-all", { method: "POST" }); toast(r.message); done(); } catch (e) { toast(e.message, "err"); } };
  const remove = async (n) => { try { await api(`/notifications/${n.id}`, { method: "DELETE" }); setSel(null); done(); } catch (e) { toast(e.message, "err"); } };
  const pref = async (k, v) => { try { await api("/settings", { method: "PUT", body: { settings: { [k]: v } } }); refresh(); } catch (e) { toast(e.message, "err"); } };
  const days = Array.from({ length: 7 }, (_, i) => { const dt = new Date(); dt.setDate(dt.getDate() - 6 + i); const k = ymd(dt), r = (data?.last7 || []).find((x) => x.date === k); return { label: `${String(dt.getDate()).padStart(2, "0")} ${dt.toLocaleString("en", { month: "short" })}`, value: r ? r.n : 0 }; });
  return (
    <div className={`page split ${sel ? "has-panel" : ""}`}>
      <div className="split-main">
        <div className="ph"><div><h1>🔔 Notifications</h1><p className="muted">Stay updated with important alerts, activities and system notifications</p></div><button className="btn" onClick={readAll}>✓ Mark All as Read</button></div>
        <div className="ncards">{TYPES.map(([k, l, ic]) => <button key={k} className={`ncard ${f.type === k ? "on" : ""}`} onClick={() => setF({ ...f, type: k })}><span>{ic}</span><b>{l}</b>{(k === "all" ? data?.unread_total : ub[k]) > 0 && <i>{k === "all" ? data.unread_total : ub[k]}</i>}</button>)}</div>
        <div className="filters"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="all">All Status</option><option value="unread">Unread</option><option value="read">Read</option></select>
          <select value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })}><option value="all">All Time</option><option value="today">Today</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option></select></div>
        <section className="card">
          {d.error && !data ? <ErrorBox msg={d.error} retry={d.reloadFull} /> : !data ? <Loading /> : !data.notifications.length ? <Empty icon="🔔" text="No notifications found." /> : data.notifications.map((n) => (
            <div key={n.id} className={`nitem ${n.is_read ? "" : "unread"} ${sel?.id === n.id ? "sel" : ""}`} onClick={() => open(n)}>
              <span className="dd-ic">{(TYPES.find((t) => t[0] === n.type) || TYPES[8])[2]}</span><div className="nbody"><b>{n.title}</b><small>{n.message}</small></div>
              <small className="muted">{ago(n.created_at)}</small>{!n.is_read && <i className="udot" />}<Badge v={n.priority} /><span onClick={(e) => e.stopPropagation()}><Menu items={[["View details", () => open(n)], !n.is_read ? ["Mark as read", () => read(n)] : null, ["Remove", () => remove(n), true]]} /></span>
            </div>))}
          {data && <Pager page={page} total={data.total} limit={10} onPage={setPage} label="notifications" />}</section>
      </div>
      <div className={sel ? "side-panel" : "side-panel static"}>
        {sel && <><div className="sp-h"><h3>Notification Details</h3><button className="x" onClick={() => setSel(null)} aria-label="Close">✕</button></div>
          <div className="hl"><b>{sel.title}</b><Badge v={sel.priority} /></div><small className="muted">{fmtDT(sel.created_at)} ({ago(sel.created_at)})</small><p>{sel.message}</p>
          <div className="sp-actions">{LINK[sel.link_type] && <button className="btn pri" onClick={() => navigate(LINK[sel.link_type], sel.link_type === "order" ? { openId: Number(sel.link_id) } : null)}>View Details ↗</button>}<button className="btn dng" onClick={() => remove(sel)}>Remove</button></div></>}
        <Panel title="Recent Notifications (Last 7 Days)"><Bars data={days} height={150} /></Panel>
        <Panel title="Notification Settings">{PREFS.map(([k, l, h]) => <div className="prefrow" key={k}><div><b>{l}</b><small>{h}</small></div><Toggle checked={S[k]} onChange={(v) => pref(k, v)} /></div>)}</Panel>
      </div>
    </div>
  );
}

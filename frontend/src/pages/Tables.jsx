import React, { useState } from "react";
import { api, cap, elapsed, fmtDT, fmtTime, money } from "../lib/api";
import { navigate } from "../lib/store";
import { useAuth, useFetch, useShell, useUI } from "../lib/store";
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Tabs } from "../lib/ui";
import { ReceiptModal } from "../components/Receipt";

const ST = ["available", "occupied", "reserved", "cleaning", "out_of_service"];

function TableTile({ t, on, onClick }) {
  return (
    <button className={`tt ${t.status} ${on ? "on" : ""}`} onClick={onClick}>
      <div className="tt-tab"><i className="ch l" /><i className="ch r" /><i className="ch t" /><i className="ch b" /><b>{t.name}</b></div>
      <span className={`tt-s ${t.status}`}>{cap(t.status)}</span>
      {t.status === "occupied" && t.order && <div className="tt-i"><span>👥 {t.order.guests || 1} · 🕒 {fmtTime(t.status_since)}</span><b>{money(t.order.total)}</b></div>}
      {t.status === "reserved" && <div className="tt-i"><span>🕒 {t.reserved_at ? fmtTime(t.reserved_at) : "—"}</span><b>{t.reserved_for}</b></div>}
      {t.status === "cleaning" && <div className="tt-i"><span>Est. 15 min</span></div>}
      {t.status === "available" && <div className="tt-i"><span>👥 {t.capacity} seats</span></div>}
    </button>
  );
}

function Detail({ id, onClose, refresh, admin }) {
  const { can } = useAuth();
  const { toast, ask } = useUI();
  const d = useFetch(`/tables/${id}`, null, [id]);
  const [rec, setRec] = useState(false);
  const [move, setMove] = useState(false);
  const all = useFetch("/tables");
  const t = d.data?.table;
  if (!t) return <div className="side-panel">{d.error ? <ErrorBox msg={d.error} /> : <Loading />}</div>;
  const go = (path, state) => navigate(admin ? "/admin" + path : path, state);
  const posPath = admin ? "/admin/pos" : "/";
  const cancel = async () => {
    const reason = await ask(`Cancel the active order on ${t.name}? Enter a reason:`, { input: true, danger: true, okText: "Cancel order", title: "Cancel order" });
    if (reason) try { await api(`/orders/${t.order.id}/cancel`, { method: "POST", body: { reason } }); toast("Order cancelled."); d.reload(); refresh(); } catch (e) { toast(e.message, "err"); }
  };
  return (
    <div className="side-panel">
      <div className="sp-h"><h3>Table {t.name}</h3><button className="btn sm dng" onClick={onClose}>✕ Close</button></div>
      <div className="chips2"><Badge v={t.status} /><span className="chip2">🕒 {fmtTime(t.status_since)} ({elapsed(t.status_since)})</span><span className="chip2">👥 {t.capacity} seats</span></div>
      {t.status === "reserved" && <div className="kv"><span>Reserved for</span><b>{t.reserved_for}{t.reserved_phone ? ` · ${t.reserved_phone}` : ""}{t.reserved_at ? ` · ${fmtDT(t.reserved_at)}` : ""}</b></div>}
      {t.order ? (<>
        <h4 className="sp-t">Current Order</h4>
        <div className="hl"><b>Order {t.order.bill_no}</b><button className="lnk" onClick={() => go("/orders", { openId: t.order.id })}>View in Orders</button></div>
        <div className="kv"><span>👤 Customer</span><b>{t.order.customer_name}</b></div>
        <div className="kv"><span>👥 Guests</span><b>{t.order.guests}</b></div>
        <div className="kv"><span>Order Type</span><b>Dine In</b></div>
        <div className="kv"><span>Total</span><b>{money(t.order.total)} ({t.items.length} items)</b></div>
        {can("pos") && <button className="btn pri block" onClick={() => navigate(posPath, { orderId: t.order.id })}>＋ Add Items to Order</button>}
        <h4 className="sp-t">Order Items ({t.items.length})</h4>
        <div className="oitems">{t.items.map((i, k) => <div key={k} className="oi"><div className="oi-n"><b>{i.product_name}</b><small>{money(i.unit_price)}</small></div><span>x {i.qty}</span><b>{money(i.line_total)}</b></div>)}</div>
        <div className="sums"><div><span>Subtotal</span><b>{money(t.order.subtotal)}</b></div>{t.order.discount_amount > 0 && <div><span>Discount</span><b>-{money(t.order.discount_amount)}</b></div>}<div><span>GST</span><b>{money(t.order.tax_amount)}</b></div></div>
        <div className="gtot"><span>Grand Total</span><b>{money(t.order.total)}</b></div>
        <div className="sp-actions"><button className="btn pri" onClick={() => setRec(true)}>🖨 Print Bill</button>{can("pos") && <button className="btn" onClick={() => setMove(true)}>⇄ Move Table</button>}{can("orders.cancel") && <button className="btn dng" onClick={cancel}>🗑 Cancel Order</button>}</div>
      </>) : <p className="muted">No active order on this table.</p>}
      {rec && <ReceiptModal orderId={t.order.id} onClose={() => setRec(false)} />}
      {move && (
        <Modal title={`Move ${t.name} to…`} onClose={() => setMove(false)}>
          <div className="chips">{(all.data?.tables || []).filter((x) => x.id !== t.id && ["available", "cleaning"].includes(x.status)).map((x) => (
            <button key={x.id} className="tchip" onClick={async () => { try { await api(`/tables/${t.id}/move`, { method: "POST", body: { to_table_id: x.id } }); toast("Order moved."); setMove(false); onClose(); refresh(); } catch (e) { toast(e.message, "err"); } }}>{x.name}</button>))}</div>
        </Modal>
      )}
    </div>
  );
}

export default function Tables() {
  const { can } = useAuth();
  const { toast, ask } = useUI();
  const { search, admin } = useShell();
  const list = useFetch("/tables", null, [], 10000);
  const [flt, setFlt] = useState("all");
  const [view, setView] = useState("floor");
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState(null);
  const [res, setRes] = useState(null);
  const posPath = admin ? "/admin/pos" : "/";
  const all = list.data?.tables || [], counts = list.data?.counts || {};
  const shown = all.filter((t) => (flt === "all" || t.status === flt) && t.name.toLowerCase().includes(search.trim().toLowerCase()));
  const cur = all.find((t) => t.id === sel);
  const quick = async (status, extra) => { try { const r = await api(`/tables/${sel}/status`, { method: "PATCH", body: { status, ...extra } }); toast(r.message); list.reload(); } catch (e) { toast(e.message, "err"); } };
  const needSel = (fn) => () => (sel ? fn() : toast("Select a table first.", "err"));
  const save = async () => {
    try { await api(form.id ? `/tables/${form.id}` : "/tables", { method: form.id ? "PUT" : "POST", body: { name: form.name, capacity: Number(form.capacity) || 4 } }); toast("Table saved."); setForm(null); list.reload(); }
    catch (e) { toast(e.message, "err"); }
  };
  const del = async () => { if (await ask(`Delete table ${cur.name}?`, { danger: true, okText: "Delete" })) try { await api(`/tables/${cur.id}`, { method: "DELETE" }); toast("Table deleted."); setSel(null); list.reload(); } catch (e) { toast(e.message, "err"); } };
  return (
    <div className={`page split ${sel ? "has-panel" : ""}`}>
      <div className="split-main">
        <div className="ph"><div><h1>Tables</h1><p className="muted">View table status, manage orders and handle customers</p></div>
          <div className="row-end"><button className={`btn ${view === "floor" ? "pri" : ""}`} onClick={() => setView("floor")}>▦ Floor View</button><button className={`btn ${view === "list" ? "pri" : ""}`} onClick={() => setView("list")}>☰ List View</button>
            {can("tables.manage") && <button className="btn" onClick={() => setForm({ name: "", capacity: 4 })}>＋ New Table</button>}</div></div>
        <Tabs value={flt} onChange={setFlt} items={[["all", `All Tables (${all.length})`], ...ST.map((s) => [s, `${cap(s)} (${counts[s] || 0})`])]} />
        {list.error && !list.data ? <ErrorBox msg={list.error} retry={list.reloadFull} /> : !list.data ? <Loading /> : !shown.length ? <Empty icon="🪑" text="No tables found." /> : view === "floor" ? (
          <div className="floor">{shown.map((t) => <TableTile key={t.id} t={t} on={sel === t.id} onClick={() => setSel(t.id)} />)}</div>
        ) : (
          <section className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Table</th><th>Seats</th><th>Status</th><th>Order</th><th>Since</th><th>Total</th></tr></thead>
            <tbody>{shown.map((t) => <tr key={t.id} className={sel === t.id ? "sel" : ""} onClick={() => setSel(t.id)}><td><b>{t.name}</b></td><td>{t.capacity}</td><td><Badge v={t.status} /></td><td>{t.order ? t.order.bill_no : "-"}</td><td>{fmtTime(t.status_since)}</td><td>{t.order ? money(t.order.total) : "-"}</td></tr>)}</tbody></table></div></section>
        )}
        <h3 className="qa-t">Quick Actions</h3>
        <div className="qa">
          <button className="btn pri" onClick={needSel(() => (cur.status === "occupied" ? navigate(posPath, { orderId: cur.order.id }) : cur.status === "out_of_service" ? toast("Table is out of service.", "err") : navigate(posPath, { tableId: cur.id })))}>＋ Open Table</button>
          <button className="btn" onClick={needSel(() => navigate(admin ? "/admin/orders" : "/orders"))}>☰ View Orders</button>
          <button className="btn" onClick={needSel(() => setRes({ reserved_for: "", reserved_phone: "", reserved_at: "" }))}>📅 Reserve Table</button>
          <button className="btn" onClick={needSel(() => quick("cleaning"))}>🧹 Mark Cleaning</button>
          <button className="btn" onClick={needSel(() => quick("available"))}>✓ Mark Available</button>
          {can("tables.manage") && <button className="btn" onClick={needSel(() => quick("out_of_service"))}>⊘ Out of Service</button>}
          {can("tables.manage") && <button className="btn" onClick={needSel(() => setForm({ id: cur.id, name: cur.name, capacity: cur.capacity }))}>✎ Edit Table</button>}
          {can("tables.manage") && <button className="btn dng" onClick={needSel(del)}>🗑 Delete</button>}
        </div>
      </div>
      {sel && <Detail id={sel} admin={admin} onClose={() => setSel(null)} refresh={list.reload} />}
      {form && <Modal title={form.id ? "Edit Table" : "New Table"} onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn pri" onClick={save}>Save Table</button></>}>
        <Field label="Table name" req hint="Leave empty to create the next number automatically (T25, T26…)"><input value={form.name} maxLength={50} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. T25" /></Field>
        <Field label="Seating capacity"><input type="number" min="1" max="50" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field></Modal>}
      {res && <Modal title={`Reserve ${cur?.name}`} onClose={() => setRes(null)} footer={<><button className="btn" onClick={() => setRes(null)}>Cancel</button><button className="btn pri" onClick={async () => { await quick("reserved", res); setRes(null); }}>Reserve</button></>}>
        <Field label="Customer name" req><input value={res.reserved_for} onChange={(e) => setRes({ ...res, reserved_for: e.target.value })} /></Field>
        <Field label="Phone"><input value={res.reserved_phone} onChange={(e) => setRes({ ...res, reserved_phone: e.target.value })} /></Field>
        <Field label="Date & time"><input type="datetime-local" value={res.reserved_at} onChange={(e) => setRes({ ...res, reserved_at: e.target.value })} /></Field></Modal>}
    </div>
  );
}

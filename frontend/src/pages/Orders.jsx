import React, { useEffect, useState } from "react";
import { api, cap, fmtDT, fmtTime, money, preset, saveCSV, TYPES, TYPE_ICON, img } from "../lib/api";
import { navigate, takeHandoff, useAuth, useDebounced, useFetch, useShell, useUI } from "../lib/store";
import { Badge, Empty, ErrorBox, Loading, Menu, Pager, RangePicker, Tabs } from "../lib/ui";
import { ReceiptModal } from "../components/Receipt";

const FLOW = { pending: ["preparing", "ready", "completed"], preparing: ["ready", "completed"], ready: ["completed"], completed: [], cancelled: [] };
const STATUSES = ["pending", "preparing", "ready", "completed", "cancelled"];

export function OrderDetail({ id, onClose, onChanged }) {
  const { can } = useAuth();
  const { toast, ask } = useUI();
  const { admin } = useShell();
  const d = useFetch(`/orders/${id}`, null, [id]);
  const [print, setPrint] = useState(false);
  const o = d.data?.order;
  const run = async (fn, ok) => { try { await fn(); toast(ok); d.reload(); onChanged(); } catch (e) { toast(e.message, "err"); } };
  const cancel = async () => {
    const reason = await ask(`Cancel order ${o.bill_no}?${o.payment_status === "paid" ? " The payment will be marked as refunded." : ""} Enter a reason:`, { input: true, danger: true, okText: "Cancel order", placeholder: "Reason for cancellation", title: "Cancel order" });
    if (reason) run(() => api(`/orders/${id}/cancel`, { method: "POST", body: { reason } }), "Order cancelled.");
  };
  if (d.loading && !o) return <div className="side-panel"><Loading /></div>;
  if (!o) return <div className="side-panel"><ErrorBox msg={d.error || "Order not found."} /></div>;
  return (
    <div className="side-panel">
      <div className="sp-h"><h3>Order {o.bill_no}</h3><Badge v={o.status} /><button className="x" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="chips2">{o.table_name && <span className="chip2">🪑 Table: {o.table_name}</span>}<span className="chip2">{TYPE_ICON[o.order_type]} {TYPES[o.order_type]}</span><Badge v={o.payment_status} /></div>
      <div className="kv"><span>👤 Customer</span><b>{o.customer_name}{o.customer_phone ? ` · ${o.customer_phone}` : ""}</b></div>
      {o.delivery_address && <div className="kv"><span>📍 Address</span><b>{o.delivery_address}</b></div>}
      <div className="kv"><span>📅 Date</span><b>{fmtDT(o.created_at)}</b></div>
      <div className="kv"><span>🧑 Cashier</span><b>{o.created_by_name || "Cashier"}</b></div>
      {o.status === "cancelled" && <div className="errbox">Cancelled: {o.cancel_reason}</div>}
      <h4 className="sp-t">Order Items ({o.items.length})</h4>
      <div className="oitems">{o.items.map((i) => (
        <div key={i.id} className="oi"><div className="oi-img">{i.image_url ? <img src={img(i.image_url)} alt="" /> : "☕"}</div><div className="oi-n"><b>{i.product_name}</b><small>{money(i.unit_price)}</small></div><span>x {i.qty}</span><b>{money(i.line_subtotal)}</b></div>
      ))}</div>
      <div className="sums"><div><span>Subtotal</span><b>{money(o.subtotal)}</b></div>
        {o.discount_amount > 0 && <div><span>Discount{o.discount_type === "percent" ? ` (${o.discount_value}%)` : ""}</span><b>-{money(o.discount_amount)}</b></div>}
        {o.tax_breakdown.map((b) => <div key={b.rate}><span>GST ({b.rate}%){o.tax_mode === "inclusive" ? " incl." : ""}</span><b>{money(b.tax)}</b></div>)}
        {o.round_off !== 0 && <div><span>Round off</span><b>{o.round_off.toFixed(2)}</b></div>}</div>
      <div className="gtot"><span>Grand Total</span><b>{money(o.total)}</b></div>
      <h4 className="sp-t">Payment Details <Badge v={o.payment_status} /></h4>
      {o.payments.length ? o.payments.map((p, i) => <div className="kv" key={i}><span>{p.method === "cash" ? "💵" : p.method === "upi" ? "📲" : "💳"} {cap(p.method)} Payment{p.status === "refunded" ? " (refunded)" : ""}</span><b>{money(p.amount)} <small>{fmtTime(p.created_at)}</small></b></div>) : <p className="muted">No payment received yet.</p>}
      <div className="sp-actions">
        <button className="btn pri" onClick={() => setPrint(true)}>🖨 Print Bill</button>
        <button className="btn" onClick={() => setPrint(true)}>↻ Reprint</button>
        {o.is_open && can("pos") && <button className="btn" onClick={() => navigate(admin ? "/admin/pos" : "/", { orderId: o.id })}>✎ Edit Order</button>}
        {FLOW[o.status].length > 0 && can("pos") && (o.payment_status === "paid" ? FLOW[o.status] : FLOW[o.status].filter((s) => s !== "completed")).map((s) => <button key={s} className="btn" onClick={() => run(() => api(`/orders/${id}/status`, { method: "PATCH", body: { status: s } }), `Marked ${s}.`)}>Mark {cap(s)}</button>)}
        {o.status !== "cancelled" && can("orders.cancel") && <button className="btn dng" onClick={cancel}>🗑 Cancel Order</button>}
      </div>
      {print && <ReceiptModal order={{ ...o }} onClose={() => setPrint(false)} />}
    </div>
  );
}

export default function Orders() {
  const { can } = useAuth();
  const { toast } = useUI();
  const { search, admin, reload } = useShell();
  const [f, setF] = useState({ type: "all", status: "all", payment_status: "all", method: "all", ...preset("today") });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(null);
  const [print, setPrint] = useState(null);
  const dq = useDebounced(search);
  const list = useFetch("/orders", { ...f, q: dq, page, limit: 10 }, [], 15000);
  useEffect(() => { const h = takeHandoff(); if (h && h.openId) { setSel(h.openId); setF((x) => ({ ...x, from: "", to: "" })); } }, []);
  useEffect(() => setPage(1), [f, dq]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const data = list.data, c = data?.counts || { type: {}, status: {} };
  const tcount = (t) => c.type[t] || 0, all = Object.values(c.type).reduce((s, n) => s + n, 0);
  const exportCsv = async () => {
    try {
      const r = await api("/orders", { params: { ...f, q: dq, limit: 5000 } });
      saveCSV(`orders-${f.from || "all"}.csv`, r.orders, [{ label: "Bill No", key: "bill_no" }, { label: "Date", get: (o) => fmtDT(o.created_at) }, { label: "Table", key: "table_name" }, { label: "Type", get: (o) => TYPES[o.order_type] }, { label: "Customer", key: "customer_name" },
        { label: "Items", key: "items" }, { label: "Total", key: "total" }, { label: "Payment", key: "methods" }, { label: "Payment Status", key: "payment_status" }, { label: "Status", key: "status" }]);
    } catch (e) { toast(e.message, "err"); }
  };
  const act = async (o, fn, ok) => { try { await fn(); toast(ok); list.reload(); reload(); } catch (e) { toast(e.message, "err"); } };
  return (
    <div className={`page split ${sel ? "has-panel" : ""}`}>
      <div className="split-main">
        <div className="ph"><div><h1>{admin ? "Orders & Bills" : "Orders"}</h1><p className="muted">View, manage and track all orders, bills and receipts</p></div>
          {can("pos") && <button className="btn pri" onClick={() => navigate(admin ? "/admin/pos" : "/")}>＋ New Order (POS)</button>}</div>
        <Tabs value={f.type} onChange={(v) => set("type", v)} items={[["all", "🧾 All Orders", all], ["dine_in", "🍽️ Dine In", tcount("dine_in")], ["pickup", "🛍️ Pick Up", tcount("pickup")], ["delivery", "🛵 Delivery", tcount("delivery")]]} />
        <div className="filters">
          <RangePicker from={f.from} to={f.to} onChange={(r) => setF((x) => ({ ...x, ...r }))} />
          <button className="btn sm" onClick={() => setF((x) => ({ ...x, from: "", to: "" }))}>All time</button>
          <select value={f.payment_status} onChange={(e) => set("payment_status", e.target.value)}><option value="all">All Payment Status</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="refunded">Refunded</option></select>
          <select value={f.method} onChange={(e) => set("method", e.target.value)}><option value="all">All Payment Methods</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></select>
          <button className="btn" onClick={exportCsv}>⭳ Export</button>
        </div>
        <div className="pills">{[["all", "All"], ...STATUSES.map((s) => [s, cap(s)])].map(([s, l]) => <button key={s} className={`pill ${f.status === s ? "on" : ""}`} onClick={() => set("status", s)}>{l} <i>{s === "all" ? Object.values(c.status).reduce((a, b) => a + b, 0) : c.status[s] || 0}</i></button>)}</div>
        <section className="card"><div className="table-wrap">
          {list.error && !data ? <ErrorBox msg={list.error} retry={list.reloadFull} /> : !data ? <Loading /> : !data.orders.length ? <Empty icon="🧾" text="No orders found for these filters." /> : (
            <table className="tbl"><thead><tr><th>#</th><th>Bill No</th><th>Time</th><th>Table</th><th>Type</th><th>Customer</th><th>Items</th><th>Total (₹)</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{data.orders.map((o, i) => (
                <tr key={o.id} className={sel === o.id ? "sel" : ""} onClick={() => setSel(o.id)}>
                  <td>{(page - 1) * 10 + i + 1}</td><td><b>{o.bill_no}</b></td><td>{fmtTime(o.created_at)}</td><td>{o.table_name || "-"}</td><td>{TYPE_ICON[o.order_type]} {TYPES[o.order_type]}</td>
                  <td>{o.customer_name}</td><td>{o.items}</td><td><b>{money(o.total)}</b></td>
                  <td><Badge v={o.payment_status} /> <small className="muted">{o.methods ? o.methods.split(",").map(cap).join(" + ") : ""}</small></td><td><Badge v={o.status} /></td>
                  <td onClick={(e) => e.stopPropagation()}><Menu items={[["View Details", () => setSel(o.id)], ["Print Bill", () => setPrint(o.id)],
                    ...(FLOW[o.status] || []).filter((s) => o.payment_status === "paid" || s !== "completed").map((s) => [`Mark ${cap(s)}`, () => act(o, () => api(`/orders/${o.id}/status`, { method: "PATCH", body: { status: s } }), `Marked ${s}.`)]),
                    o.status !== "cancelled" && can("orders.cancel") ? ["Cancel Order", () => setSel(o.id), true] : null]} /></td>
                </tr>))}</tbody></table>
          )}
        </div>{data && <Pager page={page} total={data.total} limit={10} onPage={setPage} label="orders" />}</section>
      </div>
      {sel && <OrderDetail id={sel} onClose={() => setSel(null)} onChanged={() => { list.reload(); reload(); }} />}
      {print && <ReceiptModal orderId={print} onClose={() => setPrint(null)} />}
    </div>
  );
}

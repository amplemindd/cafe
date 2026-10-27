import React, { useEffect, useState } from "react";
import { api, fmtDate, fmtTime, money, TYPES, img, cap } from "../lib/api";
import { useAuth } from "../lib/store";
import { Modal, Loading } from "../lib/ui";

export default function Receipt({ order: o, settings: S }) {
  const inc = o.tax_mode === "inclusive";
  const methods = (o.payments || []).filter((p) => p.status !== "refunded" || o.payment_status === "refunded");
  return (
    <div className={`receipt ${S.paper_size === "58mm" ? "p58" : ""}`} id="receipt">
      <div className="r-c">
        {S.show_logo && S.logo_url ? <img className="r-logo" src={img(S.logo_url)} alt="" /> : <div className="r-cup">☕</div>}
        <h4>{S.restaurant_name}</h4>
        {S.show_restaurant_details && <p>{[S.address, S.phone && `Phone: ${S.phone}`].filter(Boolean).join(" · ")}</p>}
        {S.show_gst_details && S.gstin && <p>GSTIN: {S.gstin}</p>}
      </div>
      <hr />
      <div className="r-kv"><span>Bill No</span><b>{o.bill_no}</b></div>
      <div className="r-kv"><span>Date</span><span>{fmtDate(o.paid_at || o.created_at)}</span></div>
      <div className="r-kv"><span>Time</span><span>{fmtTime(o.paid_at || o.created_at)}</span></div>
      <div className="r-kv"><span>Type</span><span>{TYPES[o.order_type]}{o.table_name ? ` · Table ${o.table_name}` : ""}</span></div>
      {o.customer_name && o.customer_name !== "Walk-in" && <div className="r-kv"><span>Customer</span><span>{o.customer_name}</span></div>}
      <hr />
      <table className="r-t"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>{o.items.map((i) => <tr key={i.id || i.product_name}><td>{i.product_name}</td><td>{i.qty}</td><td>{i.unit_price}</td><td>{i.line_subtotal}</td></tr>)}</tbody></table>
      <hr />
      <div className="r-kv"><span>Subtotal</span><span>{money(o.subtotal)}</span></div>
      {o.discount_amount > 0 && <div className="r-kv"><span>Discount</span><span>-{money(o.discount_amount)}</span></div>}
      {S.show_tax_on_bill && o.tax_amount > 0 && (o.tax_breakdown || []).map((b) => (
        <div className="r-kv" key={b.rate}><span>{inc ? "Incl. " : ""}GST ({b.rate}%){S.show_gst_details ? ` CGST ${(b.tax / 2).toFixed(2)} + SGST ${(b.tax / 2).toFixed(2)}` : ""}</span><span>{money(b.tax)}</span></div>
      ))}
      {o.round_off !== 0 && <div className="r-kv"><span>Round off</span><span>{o.round_off > 0 ? "+" : ""}{o.round_off.toFixed(2)}</span></div>}
      <div className="r-kv r-total"><span>Total</span><span>{money(o.total)}</span></div>
      <hr />
      {methods.length > 0 && <div className="r-kv"><span>Payment</span><span>{methods.map((p) => `${cap(p.method)} ${money(p.amount)}`).join(" + ")}</span></div>}
      <div className="r-kv"><span>Status</span><b>{o.payment_status === "paid" ? "PAID" : o.payment_status === "refunded" ? "REFUNDED" : o.status === "cancelled" ? "CANCELLED" : "UNPAID"}</b></div>
      {S.show_thanks && <div className="r-c r-foot">{String(S.footer_message || "").split("\n").map((l, i) => <p key={i}>{l}</p>)}</div>}
      <div className="r-c r-code">#{o.bill_no}</div>
    </div>
  );
}

export function ReceiptModal({ order, orderId, onClose, auto }) {
  const { settings } = useAuth();
  const [d, setD] = useState(order ? { order, S: settings } : null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (order || !orderId) return;
    api(`/orders/${orderId}/receipt`).then((r) => setD({ order: r.order, S: { ...settings, ...r.receipt_settings } })).catch((e) => setErr(e.message));
  }, [order, orderId, settings]);
  useEffect(() => { document.body.classList.add("print-receipt"); return () => document.body.classList.remove("print-receipt"); }, []);
  useEffect(() => { if (auto && d) { const t = setTimeout(() => window.print(), 400); return () => clearTimeout(t); } }, [auto, d]);
  return (
    <Modal title="Bill / Receipt" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn pri" onClick={() => window.print()}>🖨 Print Bill</button></>}>
      {err ? <div className="errbox">⚠ {err}</div> : d ? <Receipt order={d.order} settings={d.S} /> : <Loading />}
    </Modal>
  );
}

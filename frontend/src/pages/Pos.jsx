import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, img, money, TYPES, TYPE_ICON, uid, cap } from "../lib/api";
import { takeHandoff, useAuth, useDebounced, useFetch, useShell, useUI } from "../lib/store";
import { Empty, Loading, Modal } from "../lib/ui";
import { ReceiptModal } from "../components/Receipt";

const stockTag = (p) => (!p.track_stock ? ["In Stock", "ok"] : p.stock_qty <= 0 ? ["Out of Stock", "no"] : p.stock_qty <= p.low_stock_level ? [`Only ${p.stock_qty} left`, "low"] : ["In Stock", "ok"]);
const blank = { id: null, name: "", phone: "", address: "" };

export default function Pos() {
  const { settings: S, can } = useAuth();
  const { toast, ask } = useUI();
  const { search, catSel, setCatSel, reload } = useShell();
  const cats = useFetch("/categories", { pos: 1 });
  const prods = useFetch("/products", { pos: 1, limit: 2000 });
  const tabs = useFetch("/tables", null, [], 10000);
  const [cart, setCart] = useState([]);
  const [type, setType] = useState(S.default_order_type || "dine_in");
  const [tableId, setTableId] = useState(null);
  const [orderId, setOrderId] = useState(null);
  const [cust, setCust] = useState(blank);
  const [guests, setGuests] = useState(1);
  const [dPct, setDPct] = useState(0);
  const [dFix, setDFix] = useState("");
  const [method, setMethod] = useState(S.default_payment_method || "cash");
  const [payModal, setPayModal] = useState(null);
  const [calc, setCalc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [sheet, setSheet] = useState(false);
  const idem = useRef(uid());

  const categories = cats.data?.categories || [];
  const products = useMemo(() => prods.data?.products || [], [prods.data]);
  const tables = tabs.data?.tables || [];
  const table = tables.find((t) => t.id === tableId);
  const cat = catSel || (categories[0] && categories[0].id) || "all";
  const enabledTypes = ["dine_in", "pickup", "delivery"].filter((t) => ({ dine_in: S.dine_in_enabled, pickup: S.takeaway_enabled, delivery: S.delivery_enabled })[t]);
  const methods = [["cash", "💵"], ["upi", "📲"], ["card", "💳"]].filter(([m]) => S["pm_" + m]);
  const canDiscount = S.allow_discounts && can("discount");
  const discount = +dFix > 0 ? { type: "fixed", value: +dFix } : { type: "percent", value: +dPct || 0 };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) return products.filter((p) => `${p.name} ${p.sku || ""} ${p.category_name || ""}`.toLowerCase().includes(q));
    return cat === "all" ? products : products.filter((p) => String(p.category_id) === String(cat));
  }, [products, cat, search]);
  const catName = search.trim() ? "Search results" : cat === "all" ? "All Items" : (categories.find((c) => String(c.id) === String(cat)) || {}).name || "Menu";

  const loadOrder = useCallback(async (id) => {
    try {
      const { order: o } = await api(`/orders/${id}`);
      if (!o.is_open) return toast("This order is already closed.", "err");
      setOrderId(o.id); setType(o.order_type); setTableId(o.table_id); setGuests(o.guests || 1);
      setCust({ id: o.customer_id, name: o.customer_name === "Walk-in" ? "" : o.customer_name, phone: o.customer_phone || "", address: o.delivery_address || "" });
      setCart(o.items.map((i) => ({ id: i.product_id, name: i.product_name, price: i.unit_price, qty: i.qty })));
      if (o.discount_amount > 0 && o.discount_type === "percent") { setDPct(o.discount_value); setDFix(""); }
      else if (o.discount_amount > 0) { setDFix(String(o.discount_value)); setDPct(0); } else { setDPct(0); setDFix(""); }
      idem.current = uid();
    } catch (e) { toast(e.message, "err"); }
  }, [toast]);

  useEffect(() => {
    const h = takeHandoff();
    if (!h) return;
    if (h.orderId) loadOrder(h.orderId);
    else { if (h.type) setType(h.type); if (h.tableId) { setType("dine_in"); setTableId(h.tableId); } if (h.customer) setCust({ ...blank, ...h.customer }); }
  }, [loadOrder]);

  const key = useDebounced(JSON.stringify([cart.map((c) => [c.id, c.qty]), type, dPct, dFix]), 250);
  useEffect(() => {
    if (!cart.length) { setCalc(null); return; }
    let live = true;
    api("/orders/preview", { method: "POST", body: { items: cart.map((c) => ({ product_id: c.id, qty: c.qty })), discount, order_type: type } }).then((r) => live && setCalc(r.calc)).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const add = (p) => {
    const [, st] = stockTag(p);
    if (st === "no") return toast(`${p.name} is out of stock.`, "err");
    setCart((c) => {
      const f = c.find((x) => x.id === p.id);
      if (f) { if (p.track_stock && f.qty >= p.stock_qty) { toast(`Only ${p.stock_qty} of ${p.name} in stock.`, "err"); return c; } return c.map((x) => (x.id === p.id ? { ...x, qty: Math.min(x.qty + 1, 99) } : x)); }
      return [...c, { id: p.id, name: p.name, price: p.price, qty: 1 }];
    });
  };
  const step = (id, d) => setCart((c) => c.map((x) => (x.id === id ? { ...x, qty: Math.min(x.qty + d, 99) } : x)).filter((x) => x.qty > 0));
  const reset = () => { setCart([]); setOrderId(null); setTableId(null); setCust(blank); setGuests(1); setDPct(0); setDFix(""); setCalc(null); setPayModal(null); idem.current = uid(); setSheet(false); };
  const newOrder = async () => { if (cart.length && !(await ask("Start a new order? Items in the current cart will be removed.", { danger: true, okText: "Start new" }))) return; reset(); };
  const clearAll = async () => { if (cart.length && (await ask("Remove all items from this order?", { danger: true, okText: "Clear all" }))) { setCart([]); setCalc(null); } };

  const pickTable = async (t) => {
    if (t.status === "out_of_service") return toast(`${t.name} is out of service.`, "err");
    if (t.status === "reserved") return toast(`${t.name} is reserved${t.reserved_for ? " for " + t.reserved_for : ""}. Mark it Available from the Tables page first.`, "err");
    setType("dine_in");
    if (t.order) {
      if (t.order.id === orderId) return;
      if (cart.length && !(await ask(`${t.name} already has an active order. Replace your current cart with it?`, { okText: "Open order" }))) return;
      return loadOrder(t.order.id);
    }
    setTableId(t.id);
  };
  const lookup = async () => {
    const ph = cust.phone.replace(/\D/g, "");
    if (ph.length < 7 || cust.id) return;
    try { const r = await api("/customers", { params: { q: ph, limit: 1 } }); const c = r.customers[0]; if (c && c.phone && c.phone.replace(/\D/g, "").endsWith(ph.slice(-10))) { setCust((x) => ({ ...x, id: c.id, name: x.name || c.name, address: x.address || c.address || "" })); toast(`Customer found: ${c.name}`); } } catch { /* optional */ }
  };

  const validate = () => (!cart.length ? "Add at least one item to the order." : type === "dine_in" && !tableId ? "Please select a table for Dine In." : type === "delivery" && !(cust.name.trim() && cust.phone.trim() && cust.address.trim()) ? "Delivery orders need customer name, phone and address." : "");
  const payload = (action, payments) => ({ id: orderId || undefined, action, order_type: type, table_id: type === "dine_in" ? tableId : undefined, customer_id: cust.id || undefined, customer_name: cust.name, customer_phone: cust.phone,
    delivery_address: cust.address, guests, items: cart.map((c) => ({ product_id: c.id, qty: c.qty })), discount, payments, idempotency_key: orderId ? undefined : idem.current });

  async function hold() {
    const v = validate(); if (v) return toast(v, "err");
    setBusy(true);
    try { await api("/orders", { method: "POST", body: payload("hold") }); toast(`Order put on hold${table ? " for " + table.name : ""}.`); reset(); tabs.reload(); reload(); }
    catch (e) { toast(e.message, "err"); } finally { setBusy(false); }
  }
  async function checkout(payments) {
    setBusy(true);
    try { const r = await api("/orders", { method: "POST", body: payload("pay", payments) }); setReceipt(r.order); reset(); tabs.reload(); reload(); prods.reload(); }
    catch (e) { setPayModal(null); toast(e.message, "err"); } finally { setBusy(false); }
  }
  function startCheckout() {
    const v = validate(); if (v) return toast(v, "err");
    if (!calc) return toast("Calculating the bill, please try again.", "err");
    if (method === "split") return setPayModal({ type: "split", rows: Object.fromEntries(methods.map(([m]) => [m, ""])) });
    if (method === "upi") return setPayModal({ type: "upi", ref: "" });
    checkout([{ method, amount: calc.total }]);
  }

  const tableLabel = type === "dine_in" ? (table ? `Table: ${table.name}` : "No table selected") : type === "pickup" ? "Pick Up order" : "Delivery order";
  const count = cart.reduce((s, c) => s + c.qty, 0);
  const TypeBtns = ({ small }) => (
    <div className={small ? "types sm" : "types"}>
      {enabledTypes.map((t) => <button key={t} className={`tbtn ${type === t ? "on" : ""}`} onClick={() => { setType(t); if (t !== "dine_in") setTableId(null); }}>{TYPE_ICON[t]} {TYPES[t]}</button>)}
    </div>
  );

  return (
    <div className="pos">
      <div className="pos-l">
        <div className="sec-t">Select Table</div>
        <div className="chips">
          {tabs.loading && !tables.length && <span className="muted">Loading tables…</span>}
          {tables.map((t) => <button key={t.id} title={cap(t.status)} className={`tchip ${tableId === t.id ? "sel" : ""} ${t.status}`} onClick={() => pickTable(t)}>{t.name}</button>)}
          <button className="tchip add" onClick={newOrder}>＋ New Order</button>
        </div>
        <div className="typerow">
          <TypeBtns />
          <label className="cphone">👤<input value={cust.phone} inputMode="tel" maxLength={20} placeholder={`Customer Phone ${type === "delivery" ? "" : "(Optional)"}`} onChange={(e) => setCust({ ...cust, phone: e.target.value, id: null })} onBlur={lookup} /></label>
        </div>
        {(type !== "dine_in" || cust.name) && (
          <div className="cfields">
            <input value={cust.name} maxLength={100} placeholder={`Customer name${type === "delivery" ? " *" : ""}`} onChange={(e) => setCust({ ...cust, name: e.target.value })} />
            {type === "delivery" && <input value={cust.address} maxLength={255} placeholder="Delivery address *" onChange={(e) => setCust({ ...cust, address: e.target.value })} />}
          </div>
        )}
        <div className="sec-h"><h3>{catName} <small>({visible.length} items)</small></h3><button className="lnk" onClick={() => setCatSel("all")}>View All ›</button></div>
        {prods.loading && !products.length ? <Loading text="Loading menu…" /> : prods.error ? <div className="errbox">⚠ {prods.error}</div> : !visible.length ? <Empty icon="🍽️" text={search ? "No items match your search." : "No items in this category yet."} /> : (
          <div className="pgrid">
            {visible.map((p) => {
              const [tag, st] = stockTag(p), q = cart.find((c) => c.id === p.id)?.qty;
              return (
                <div key={p.id} className={`pcard ${st === "no" ? "off" : ""}`} onClick={() => add(p)}>
                  {q && <i className="pq">{q}</i>}
                  <div className="pname" title={p.name}>{p.name}</div>
                  <div className="pprice">{money(p.price)}</div>
                  <div className="pfoot"><span className={`stk ${st}`}>{tag}</span><button className="padd" aria-label={`Add ${p.name}`} disabled={st === "no"}>＋</button></div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <aside className={`cart ${sheet ? "open" : ""}`}>
        <div className="cart-h"><h3>My Order</h3><button className="lnk dng" onClick={clearAll}>🗑 Clear All</button><button className="x mob" onClick={() => setSheet(false)}>✕</button></div>
        <div className="tbox">🪑 {tableLabel}{orderId && <span className="badge amber">On hold</span>}</div>
        <TypeBtns small />
        <div className="clines">
          {!cart.length && <Empty icon="🛒" text="Tap an item to add it to the order." />}
          {cart.map((c) => (
            <div className="cl" key={c.id}>
              
              <div className="cl-n"><b>{c.name}</b><small>{money(c.price)}</small></div>
              <div className="stepper"><button onClick={() => step(c.id, -1)} aria-label="Decrease">−</button><span>{c.qty}</span><button onClick={() => step(c.id, 1)} aria-label="Increase">＋</button></div>
              <div className="cl-p">{money(c.price * c.qty)}</div>
              <button className="cl-x" onClick={() => step(c.id, -c.qty)} aria-label={`Remove ${c.name}`}>✕</button>
            </div>
          ))}
        </div>
        {canDiscount && (
          <div className="disc">
            <span className="dico">％</span><span>Apply Discount</span>
            <select value={dPct} disabled={+dFix > 0} onChange={(e) => setDPct(e.target.value)}>{[0, 5, 10, 15, 20, 25].map((v) => <option key={v} value={v}>{v}%</option>)}</select>
            <input type="number" min="0" placeholder="₹ 0" value={dFix} onChange={(e) => setDFix(e.target.value)} aria-label="Discount amount" />
          </div>
        )}
        <div className="sums">
          <div><span>Sub Total</span><b>{money(calc ? calc.subtotal : 0)}</b></div>
          {calc && calc.discount_amount > 0 && <div><span>Discount</span><b>-{money(calc.discount_amount)}</b></div>}
          {S.tax_enabled && <div><span>{calc && calc.breakdown.length === 1 ? `GST (${calc.breakdown[0].rate}%)` : "GST"}{calc && calc.mode === "inclusive" ? " (incl.)" : ""}</span><b>{money(calc ? calc.tax_amount : 0)}</b></div>}
          {calc && calc.round_off !== 0 && <div><span>Round off</span><b>{calc.round_off > 0 ? "+" : ""}{calc.round_off.toFixed(2)}</b></div>}
        </div>
        <div className="gtot"><span>Grand Total</span><b>{money(calc ? calc.total : 0)}</b></div>
        <div className="pays">
          {methods.map(([m, ic]) => <button key={m} className={`pm ${method === m ? "on" : ""}`} onClick={() => setMethod(m)}>{ic} {cap(m)}</button>)}
          {S.pm_split && <button className={`pm ${method === "split" ? "on" : ""}`} onClick={() => setMethod("split")}>👥 Split</button>}
        </div>
        <div className="cta">
          <button className="btn block" disabled={busy || !cart.length} onClick={hold}>⏸ Hold</button>
          <button className="btn pri block lg" disabled={busy || !cart.length} onClick={startCheckout}>🖨 {busy ? "Processing…" : "Checkout & Print Receipt"}</button>
        </div>
      </aside>
      {count > 0 && !sheet && <button className="mbar" onClick={() => setSheet(true)}>🛒 {count} item{count > 1 ? "s" : ""} · {money(calc ? calc.total : 0)} — View order</button>}

      {payModal?.type === "upi" && (
        <Modal title="UPI Payment" onClose={() => setPayModal(null)} footer={<><button className="btn" onClick={() => setPayModal(null)}>Cancel</button><button className="btn pri" disabled={busy} onClick={() => checkout([{ method: "upi", amount: calc.total, reference: payModal.ref }])}>{busy ? "Processing…" : "Payment Received"}</button></>}>
          <div className="big-amt">{money(calc.total)}</div>
          {S.pm_qr && S.qr_image_url ? <img className="qr" src={img(S.qr_image_url)} alt="UPI QR code" /> : S.upi_id ? <p className="center">Pay to UPI ID: <b>{S.upi_id}</b></p> : <p className="muted center">Ask the customer to pay by UPI.</p>}
          <label className="fld"><span>Transaction reference (optional)</span><input value={payModal.ref} maxLength={100} onChange={(e) => setPayModal({ ...payModal, ref: e.target.value })} /></label>
          <p className="muted">Confirm only after the payment has been received.</p>
        </Modal>
      )}
      {payModal?.type === "split" && (() => {
        const rows = payModal.rows, sum = Object.values(rows).reduce((s, v) => s + (+v || 0), 0), left = Math.round((calc.total - sum) * 100) / 100;
        return (
          <Modal title="Split Payment" onClose={() => setPayModal(null)} footer={<><button className="btn" onClick={() => setPayModal(null)}>Cancel</button>
            <button className="btn pri" disabled={busy || Math.abs(left) > 0.009} onClick={() => checkout(Object.entries(rows).filter(([, v]) => +v > 0).map(([m, v]) => ({ method: m, amount: +v })))}>{busy ? "Processing…" : "Confirm & Checkout"}</button></>}>
            <div className="big-amt">{money(calc.total)}</div>
            {Object.keys(rows).map((m) => <div className="splitrow" key={m}><span>{cap(m)}</span><input type="number" min="0" placeholder="0.00" value={rows[m]} onChange={(e) => setPayModal({ ...payModal, rows: { ...rows, [m]: e.target.value } })} /><button className="btn sm" onClick={() => setPayModal({ ...payModal, rows: { ...rows, [m]: String(Math.max(Math.round((+rows[m] + left) * 100) / 100, 0)) } })}>Rest</button></div>)}
            <p className={Math.abs(left) > 0.009 ? "errtxt" : "muted"}>{Math.abs(left) > 0.009 ? `Remaining: ${money(left)}` : "Amounts match the bill ✓"}</p>
          </Modal>
        );
      })()}
      {receipt && <ReceiptModal order={receipt} auto={S.auto_print} onClose={() => setReceipt(null)} />}
    </div>
  );
}

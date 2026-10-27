import React, { useState } from "react";
import { api, money, preset, fmtDate } from "../lib/api";
import { useAuth, useFetch, useShell, useUI } from "../lib/store";
import { Badge, ErrorBox, Field, Loading, Panel, Stat, Tabs, Toggle } from "../lib/ui";

const blank = { name: "", rate: "", description: "", is_active: true };

export default function Taxes() {
  const { settings: S, refresh } = useAuth();
  const { toast, ask } = useUI();
  const { search } = useShell();
  const [period, setPeriod] = useState("month");
  const d = useFetch("/taxes", preset(period), [period]);
  const [tab, setTab] = useState("rates");
  const [form, setForm] = useState(blank);
  const [cf, setCf] = useState("");
  const [inv, setInv] = useState(null);
  if (d.error && !d.data) return <div className="page"><ErrorBox msg={d.error} retry={d.reloadFull} /></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const { rates, categories, products, summary } = d.data;
  const rateLabel = (id) => (rates.find((r) => r.id === id) || {}).name || "";
  const run = async (fn, ok) => { try { const r = await fn(); toast(ok || r.message); d.reload(); return true; } catch (e) { toast(e.message, "err"); return false; } };
  const saveSettings = async (patch, ok = "Settings saved.") => { if (await run(() => api("/settings", { method: "PUT", body: { settings: patch } }), ok)) refresh(); };
  const saveRate = async (e) => { e.preventDefault(); if (await run(() => api(form.id ? `/taxes/${form.id}` : "/taxes", { method: form.id ? "PUT" : "POST", body: form }), "Tax rate saved.")) setForm(blank); };
  const iv = inv || { tax_enabled: S.tax_enabled, default_tax_rate_id: S.default_tax_rate_id, tax_mode: S.tax_mode, round_off: S.round_off, show_tax_on_bill: S.show_tax_on_bill, show_gst_details: S.show_gst_details, gstin: S.gstin };
  const prods = products.filter((p) => (!cf || String(p.category_id) === cf) && p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const RateSel = ({ value, onChange, empty }) => <select value={value || ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}><option value="">{empty}</option>{rates.filter((r) => r.is_active || r.id === value).map((r) => <option key={r.id} value={r.id}>{r.rate}% ({r.name})</option>)}</select>;
  return (
    <div className="page">
      <div className="ph"><div><h1>Taxes / GST Settings</h1><p className="muted">Configure GST rates, tax categories and apply them to menu items. Changes affect new bills only – past bills never change.</p></div></div>
      <div className="kpis">
        <div className="kpi t-green"><div className="kpi-i">％</div><div className="kpi-t"><small>GST Enabled</small><b>{summary.enabled ? "Yes" : "No"}</b></div><Toggle checked={summary.enabled} onChange={(v) => saveSettings({ tax_enabled: v }, v ? "GST enabled." : "GST disabled.")} /></div>
        <Stat icon="📄" label="Default GST Rate" value={`${summary.default_rate}%`} sub={summary.default_name} tone="blue" />
        <div className="kpi t-amber"><div className="kpi-i">🪙</div><div className="kpi-t"><small>Total Tax Collected</small><b>{money(summary.tax_collected)}</b></div><select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="today">Today</option><option value="week">This Week</option><option value="month">This Month</option></select></div>
        <Stat icon="🧾" label="Total Sales (Incl. Tax)" value={money(summary.sales)} sub={`${fmtDate(summary.from)} – ${fmtDate(summary.to)}`} tone="purple" />
      </div>
      <Tabs value={tab} onChange={setTab} items={[["rates", "Tax Rates"], ["categories", "Category Mapping"], ["products", "Product Wise Tax"], ["invoice", "Tax Invoice Settings"]]} />
      {tab === "rates" && (
        <div className="two-col">
          <Panel title="GST / Tax Rates" pad={false}><table className="tbl"><thead><tr><th>#</th><th>Tax Name</th><th>Rate (%)</th><th>Description</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{rates.map((r, i) => <tr key={r.id}><td>{i + 1}</td><td><b>{r.name}</b></td><td>{r.rate}</td><td className="muted">{r.description}</td>
              <td><Toggle checked={r.is_active} onChange={(v) => run(() => api(`/taxes/${r.id}`, { method: "PUT", body: { ...r, is_active: v } }), "Tax rate updated.")} /></td>
              <td className="macts"><button className="btn sm" onClick={() => setForm({ ...r, is_active: !!r.is_active, description: r.description || "" })}>✎ Edit</button>
                <button className="btn sm ico dng" aria-label="Delete" onClick={async () => { if (await ask(`Delete ${r.name}?`, { danger: true, okText: "Delete" })) run(() => api(`/taxes/${r.id}`, { method: "DELETE" })); }}>🗑</button></td></tr>)}</tbody></table></Panel>
          <form className="card" onSubmit={saveRate}><div className="card-h"><h3>{form.id ? "Edit" : "Add"} Tax Rate</h3></div><div className="card-b">
            <Field label="Tax Name" req><input required value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. GST 5%" /></Field>
            <Field label="Tax Rate (%)" req><input required type="number" min="0" max="100" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></Field>
            <Field label="Description"><textarea rows={2} maxLength={200} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Active" />
            <p className="note">Make sure the rate matches your restaurant's actual GST registration and applicable rules.</p>
            <div className="sp-actions">{form.id && <button type="button" className="btn" onClick={() => setForm(blank)}>Cancel</button>}<button className="btn pri">Save Tax Rate</button></div></div></form>
        </div>
      )}
      {tab === "categories" && <Panel title="Category Wise Tax Mapping" pad={false}><table className="tbl"><thead><tr><th>#</th><th>Category</th><th>Assigned GST Rate</th><th>Status</th></tr></thead>
        <tbody>{categories.map((c, i) => <tr key={c.id}><td>{i + 1}</td><td>{c.icon} <b>{c.name}</b></td><td><RateSel value={c.tax_rate_id} empty={`Default (${summary.default_rate}%)`} onChange={(v) => run(() => api(`/taxes/mappings/categories/${c.id}`, { method: "PUT", body: { tax_rate_id: v } }))} /></td><td><Badge kind={c.is_active ? "green" : "gray"}>{c.is_active ? "Active" : "Inactive"}</Badge></td></tr>)}</tbody></table></Panel>}
      {tab === "products" && (
        <Panel title="Product Wise Tax (Override)" right={<select value={cf} onChange={(e) => setCf(e.target.value)}><option value="">All Categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>} pad={false}>
          <p className="note pad">If enabled, the product uses its own GST rate instead of the category rate. (Use the header search to find a product.)</p>
          <div className="table-wrap"><table className="tbl"><thead><tr><th>#</th><th>Product</th><th>Category</th><th>Effective rate</th><th>Use Custom</th><th>Custom GST Rate</th></tr></thead>
            <tbody>{prods.map((p, i) => <tr key={p.id}><td>{i + 1}</td><td><b>{p.name}</b></td><td>{p.category_name}</td><td>{p.tax_rate_id ? rateLabel(p.tax_rate_id) : p.category_tax_rate_id ? rateLabel(p.category_tax_rate_id) : `Default (${summary.default_rate}%)`}</td>
              <td><Toggle checked={!!p.tax_rate_id} onChange={(v) => run(() => api(`/taxes/mappings/products/${p.id}`, { method: "PUT", body: { tax_rate_id: v ? (rates.find((r) => r.is_active) || {}).id : null } }))} /></td>
              <td>{p.tax_rate_id ? <RateSel value={p.tax_rate_id} empty="Select" onChange={(v) => run(() => api(`/taxes/mappings/products/${p.id}`, { method: "PUT", body: { tax_rate_id: v } }))} /> : <span className="muted">—</span>}</td></tr>)}</tbody></table></div></Panel>
      )}
      {tab === "invoice" && (
        <Panel title="Tax Invoice Settings"><div className="form-grid">
          <Toggle checked={iv.tax_enabled} onChange={(v) => setInv({ ...iv, tax_enabled: v })} label="Enable GST calculation on bills" />
          <Field label="Default GST rate (used when category/product has none)"><select value={iv.default_tax_rate_id} onChange={(e) => setInv({ ...iv, default_tax_rate_id: Number(e.target.value) })}><option value={0}>No default (0%)</option>{rates.filter((r) => r.is_active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          <Field label="Price mode"><select value={iv.tax_mode} onChange={(e) => setInv({ ...iv, tax_mode: e.target.value })}><option value="exclusive">Exclusive – tax is added on the bill</option><option value="inclusive">Inclusive – tax is already in the price</option></select></Field>
          <Field label="Round off total"><select value={iv.round_off} onChange={(e) => setInv({ ...iv, round_off: e.target.value })}><option value="nearest1">Nearest ₹1</option><option value="none">No rounding</option></select></Field>
          <Toggle checked={iv.show_tax_on_bill} onChange={(v) => setInv({ ...iv, show_tax_on_bill: v })} label="Show GST on the bill" />
          <Toggle checked={iv.show_gst_details} onChange={(v) => setInv({ ...iv, show_gst_details: v })} label="Show GSTIN and CGST / SGST split" />
          <Field label="GSTIN"><input value={iv.gstin} maxLength={20} onChange={(e) => setInv({ ...iv, gstin: e.target.value.toUpperCase() })} placeholder="27ABCDE1234F1Z5" /></Field></div>
          <div className="sp-actions"><button className="btn pri" disabled={!inv} onClick={async () => { await saveSettings(inv, "Tax invoice settings saved."); setInv(null); }}>Save Settings</button></div></Panel>
      )}
    </div>
  );
}

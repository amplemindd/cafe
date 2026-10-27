import React, { useState } from "react";
import { api, img } from "../lib/api";
import { useAuth, useDebounced, useFetch, useShell, useUI } from "../lib/store";
import { Badge, Empty, ErrorBox, Field, ImagePick, Loading, Modal, Toggle } from "../lib/ui";

const ICONS = ["☕", "🍵", "🍟", "🥐", "🥪", "🥤", "🎁", "🍰", "🍕", "🍔", "🍝", "🍦", "🥗", "🍩", "🧃", "🍜", "🌮", "🥞"];
const blank = { name: "", icon: "☕", description: "", is_active: true, show_in_pos: true, tax_rate_id: "", image: "", image_url: "" };

export default function Categories() {
  const { can } = useAuth();
  const { toast, ask } = useUI();
  const { search, reload } = useShell();
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState("all");
  const dq = useDebounced(search);
  const list = useFetch("/categories", { q: dq, status });
  const taxes = useFetch(can("taxes") ? "/taxes" : "");
  const cats = list.data?.categories || [];
  const refresh = () => { list.reload(); reload(); };
  const save = async () => {
    try {
      await api(form.id ? `/categories/${form.id}` : "/categories", { method: form.id ? "PUT" : "POST", body: { ...form, image_data: form.image || undefined, remove_image: !form.image && !form.image_url && form.id ? true : undefined } });
      toast("Category saved."); setForm(null); refresh();
    } catch (e) { toast(e.message, "err"); }
  };
  const flip = async (c) => { try { await api(`/categories/${c.id}/status`, { method: "PATCH", body: { is_active: !c.is_active } }); refresh(); } catch (e) { toast(e.message, "err"); } };
  const del = async (c) => { if (await ask(`Delete category "${c.name}"?`, { danger: true, okText: "Delete" })) try { const r = await api(`/categories/${c.id}`, { method: "DELETE" }); toast(r.message); refresh(); } catch (e) { toast(e.message, "err"); } };
  const move = async (i, d) => {
    const ids = cats.map((c) => c.id), j = i + d; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await api("/categories/reorder", { method: "POST", body: { ids } }); refresh(); } catch (e) { toast(e.message, "err"); }
  };
  return (
    <div className="page">
      <div className="ph"><div><h1>Categories</h1><p className="muted">Organise your menu. Changes appear in POS and Menu Items immediately.</p></div>
        <div className="row-end"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
          <button className="btn pri" onClick={() => setForm({ ...blank })}>＋ Add Category</button></div></div>
      <section className="card"><div className="table-wrap">
        {list.error && !list.data ? <ErrorBox msg={list.error} retry={list.reloadFull} /> : !list.data ? <Loading /> : !cats.length ? <Empty icon="🗂️" text="No categories yet. Add your first category." /> : (
          <table className="tbl"><thead><tr><th>Order</th><th>Category</th><th>Description</th><th>Items</th><th>Show in POS</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{cats.map((c, i) => (
              <tr key={c.id}>
                <td className="macts"><button className="btn sm ico" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">▲</button><button className="btn sm ico" disabled={i === cats.length - 1} onClick={() => move(i, 1)} aria-label="Move down">▼</button></td>
                <td><span className="mini">{c.image_url ? <img src={img(c.image_url)} alt="" /> : c.icon}</span> <b>{c.name}</b></td><td className="muted">{c.description || "-"}</td><td>{c.product_count}</td>
                <td><Toggle checked={c.show_in_pos} onChange={async (v) => { try { await api(`/categories/${c.id}`, { method: "PUT", body: { ...c, show_in_pos: v } }); refresh(); } catch (e) { toast(e.message, "err"); } }} /></td>
                <td><button className="plain" onClick={() => flip(c)}><Badge kind={c.is_active ? "green" : "gray"}>{c.is_active ? "Active" : "Inactive"}</Badge></button></td>
                <td className="macts"><button className="btn sm ico" onClick={() => setForm({ ...blank, ...c, tax_rate_id: c.tax_rate_id || "", is_active: !!c.is_active, show_in_pos: !!c.show_in_pos, image: "", image_url: c.image_url ? img(c.image_url) : "", description: c.description || "" })} aria-label="Edit">✎</button><button className="btn sm ico dng" onClick={() => del(c)} aria-label="Delete">🗑</button></td>
              </tr>))}</tbody></table>
        )}</div></section>
      {form && (
        <Modal title={form.id ? "Edit Category" : "Add Category"} onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn pri" onClick={save}>Save Category</button></>}>
          <Field label="Category name" req><input value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Coffee" /></Field>
          <div className="fld"><span>Icon</span><div className="icons">{ICONS.map((ic) => <button key={ic} type="button" className={`ico-b ${form.icon === ic ? "on" : ""}`} onClick={() => setForm({ ...form, icon: ic })}>{ic}</button>)}</div></div>
          <Field label="Description"><input value={form.description} maxLength={255} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          {can("taxes") && <Field label="Default GST rate for this category"><select value={form.tax_rate_id} onChange={(e) => setForm({ ...form, tax_rate_id: e.target.value })}><option value="">Use default rate</option>{(taxes.data?.rates || []).filter((r) => r.is_active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>}
          <ImagePick value={form.image || form.image_url} onChange={(v) => setForm({ ...form, image: v, image_url: v ? form.image_url : "" })} label="Category image (optional)" />
          <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Active" />
          <Toggle checked={form.show_in_pos} onChange={(v) => setForm({ ...form, show_in_pos: v })} label="Show in POS" />
        </Modal>
      )}
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { api, fmtDate, money, num, preset, readFile, saveCSV, ymd, img } from "../lib/api";
import { useDebounced, useFetch, useShell, useUI } from "../lib/store";
import { Badge, Empty, ErrorBox, Field, Loading, Pager, RangePicker, Stat } from "../lib/ui";
import { Bars, Donut } from "../lib/charts";

const MODES = ["Cash", "UPI", "Card", "Bank Transfer", "Cheque"];
const blank = () => ({ expense_date: ymd(), category_id: "", name: "", supplier: "", amount: "", payment_mode: "", notes: "", attachment_data: "" });

export default function Expenses() {
  const { toast, ask } = useUI();
  const { search } = useShell();
  const [f, setF] = useState({ ...preset("month"), category_id: "", payment_mode: "", added_by: "" });
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(search);
  const params = { ...f, q: dq };
  const list = useFetch("/expenses", { ...params, page, limit: 10 });
  const sum = useFetch("/expenses/summary", params);
  const cats = useFetch("/expense-categories");
  const users = useFetch("/users");
  useEffect(() => setPage(1), [f, dq]);
  const s = sum.data?.summary;
  const refresh = () => { list.reload(); sum.reload(); };
  const save = async () => {
    setBusy(true);
    try { await api(form.id ? `/expenses/${form.id}` : "/expenses", { method: form.id ? "PUT" : "POST", body: { ...form, amount: +form.amount } }); toast("Expense saved."); setForm(null); refresh(); }
    catch (e) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const del = async (e) => { if (await ask(`Delete expense "${e.name}"? It stays in the audit log.`, { danger: true, okText: "Delete" })) try { await api(`/expenses/${e.id}`, { method: "DELETE" }); toast("Expense deleted."); refresh(); } catch (x) { toast(x.message, "err"); } };
  const addCat = async () => { const name = await ask("Name of the new expense category:", { input: true, okText: "Add", title: "New category" }); if (name) try { await api("/expense-categories", { method: "POST", body: { name } }); cats.reload(); } catch (e) { toast(e.message, "err"); } };
  const exportCsv = async () => { try { const r = await api("/expenses", { params: { ...params, limit: 5000 } }); saveCSV("expenses.csv", r.expenses, [{ label: "Date", get: (e) => fmtDate(e.expense_date) }, { label: "Category", key: "category" }, { label: "Expense", key: "name" }, { label: "Supplier", key: "supplier" }, { label: "Amount", key: "amount" }, { label: "Payment Mode", key: "payment_mode" }, { label: "Added By", key: "added_by_name" }]); } catch (e) { toast(e.message, "err"); } };
  const up = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const by = sum.data?.by_category || [], byTotal = by.reduce((a, b) => a + b.amount, 0);
  return (
    <div className={`page split ${form ? "has-panel" : ""}`}>
      <div className="split-main">
        <div className="ph"><div><h1>Expenses</h1><p className="muted">Manage your daily business expenses</p></div><div className="row-end"><button className="btn" onClick={exportCsv}>⭳ Export</button><button className="btn pri" onClick={() => setForm(blank())}>＋ Add Expense</button></div></div>
        <div className="kpis"><Stat icon="💰" label="Total Expenses" value={money(s?.total)} sub="selected period" tone="red" /><Stat icon="🛒" label="This Month" value={money(s?.month)} delta={s ? -s.month_change : undefined} sub="vs. last month" /><Stat icon="📅" label="Today's Expenses" value={money(s?.today)} tone="blue" /><Stat icon="📊" label="Average Daily Expense" value={money(s?.avg_daily)} tone="purple" /></div>
        <div className="filters"><RangePicker from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} presets={false} />
          <select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}><option value="">All Categories</option>{(cats.data?.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select value={f.payment_mode} onChange={(e) => setF({ ...f, payment_mode: e.target.value })}><option value="">All Payment Methods</option>{MODES.map((m) => <option key={m}>{m}</option>)}</select>
          <select value={f.added_by} onChange={(e) => setF({ ...f, added_by: e.target.value })}><option value="">All Staff</option>{(users.data?.users || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <section className="card"><div className="table-wrap">
          {list.error && !list.data ? <ErrorBox msg={list.error} retry={list.reloadFull} /> : !list.data ? <Loading /> : !list.data.expenses.length ? <Empty icon="💸" text="No expenses recorded for these filters." /> : (
            <table className="tbl"><thead><tr><th>#</th><th>Date</th><th>Category</th><th>Expense Name</th><th>Supplier / Vendor</th><th>Amount (₹)</th><th>Payment Mode</th><th>Added By</th><th>Action</th></tr></thead>
              <tbody>{list.data.expenses.map((e, i) => <tr key={e.id}><td>{(page - 1) * 10 + i + 1}</td><td>{fmtDate(e.expense_date)}</td><td><Badge kind="green">{e.category}</Badge></td><td>{e.name}{e.attachment && <a className="lnk" href={img(e.attachment)} target="_blank" rel="noreferrer"> 📎</a>}</td><td>{e.supplier || "-"}</td><td><b>{num(e.amount)}</b></td><td>{e.payment_mode}</td><td>{e.added_by_name || "-"}</td>
                <td className="macts"><button className="btn sm ico" aria-label="Edit" onClick={() => setForm({ ...blank(), ...e, expense_date: String(e.expense_date).slice(0, 10), supplier: e.supplier || "", notes: e.notes || "" })}>✎</button><button className="btn sm ico dng" aria-label="Delete" onClick={() => del(e)}>🗑</button></td></tr>)}</tbody></table>
          )}</div>{list.data && <Pager page={page} total={list.data.total} limit={10} onPage={setPage} label="expenses" />}</section>
        <div className="g3b">
          <Panel2 title="Monthly Expense Trend"><Bars data={(sum.data?.trend || []).map((t) => ({ label: t.k.slice(5) + "/" + t.k.slice(2, 4), value: t.v }))} fmt={(v) => (v >= 1000 ? `${Math.round(v / 1000)}K` : num(v))} highlight="last" /></Panel2>
          <Panel2 title="Category Wise Expenses"><Donut center={{ big: money(byTotal), small: "Total Expenses" }} data={by.map((b) => ({ label: b.name, value: b.amount, text: `${byTotal ? Math.round((b.amount / byTotal) * 100) : 0}%` }))} /></Panel2>
          <Panel2 title="Expense Summary"><table className="tbl sm"><thead><tr><th>Category</th><th>Amount (₹)</th><th>%</th></tr></thead><tbody>{by.map((b) => <tr key={b.name}><td>{b.name}</td><td>{num(b.amount)}</td><td>{byTotal ? Math.round((b.amount / byTotal) * 100) : 0}%</td></tr>)}</tbody></table></Panel2>
        </div>
      </div>
      {form && (
        <div className="side-panel">
          <div className="sp-h"><h3>{form.id ? "Edit Expense" : "Add New Expense"}</h3><button className="x" onClick={() => setForm(null)} aria-label="Close">✕</button></div>
          <Field label="Date" req><input type="date" value={form.expense_date} max={ymd()} onChange={up("expense_date")} /></Field>
          <Field label="Category" req><select value={form.category_id} onChange={up("category_id")}><option value="">Select Category</option>{(cats.data?.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <button className="lnk" onClick={addCat}>＋ New category</button>
          <Field label="Expense Name" req><input value={form.name} maxLength={150} onChange={up("name")} placeholder="e.g. Coffee Beans (1kg)" /></Field>
          <Field label="Supplier / Vendor"><input value={form.supplier} maxLength={150} onChange={up("supplier")} placeholder="e.g. Coffee House" /></Field>
          <Field label="Amount (₹)" req><input type="number" min="0" step="0.01" value={form.amount} onChange={up("amount")} placeholder="0.00" /></Field>
          <Field label="Payment Mode" req><select value={form.payment_mode} onChange={up("payment_mode")}><option value="">Select Payment Mode</option>{MODES.map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Notes"><textarea rows={2} maxLength={500} value={form.notes} onChange={up("notes")} placeholder="Add additional notes..." /></Field>
          <Field label="Attachment (Bill / Image / PDF, max 5 MB)"><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={async (e) => { const file = e.target.files[0]; if (!file) return; if (file.size > 5 * 1024 * 1024) { toast("File must be 5 MB or smaller.", "err"); e.target.value = ""; return; } setForm({ ...form, attachment_data: await readFile(file) }); }} /></Field>
          <div className="sp-actions"><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn pri" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save Expense"}</button></div>
        </div>
      )}
    </div>
  );
}
function Panel2({ title, children }) { return <section className="card"><div className="card-h"><h3>{title}</h3></div><div className="card-b">{children}</div></section>; }

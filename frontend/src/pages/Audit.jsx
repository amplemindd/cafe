import React, { useEffect, useState } from "react";
import { api, fmtDT, num, preset, saveCSV } from "../lib/api";
import { useDebounced, useFetch, useShell, useUI } from "../lib/store";
import { Avatar, Badge, Empty, ErrorBox, Loading, Pager, RangePicker, Stat } from "../lib/ui";

function Detail({ id, onClose }) {
  const d = useFetch(`/audit-logs/${id}`, null, [id]);
  const l = d.data?.log;
  if (!l) return <div className="side-panel">{d.error ? <ErrorBox msg={d.error} /> : <Loading />}</div>;
  return (
    <div className="side-panel">
      <div className="sp-h"><h3>Log Details</h3><button className="x" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="hl"><b>{l.module} {l.action}</b><Badge v={l.level} /></div><small className="muted">{fmtDT(l.created_at)}</small>
      <div className="kv"><span>User</span><b>{l.user_name || "System"}</b></div><div className="kv"><span>Action</span><Badge kind="green">{l.action}</Badge></div><div className="kv"><span>Module</span><b>{l.module}</b></div>
      <div className="kv"><span>IP Address</span><b>{String(l.ip || "-").replace("::ffff:", "")}</b></div><div className="kv"><span>User Agent</span><b className="wrap">{l.user_agent || "-"}</b></div>
      <div className="kv"><span>Description</span><b className="wrap">{l.details}</b></div>
      {l.old_values && <><h4 className="sp-t">Before</h4><pre className="json">{JSON.stringify(l.old_values, null, 2)}</pre></>}
      {l.new_values && <><h4 className="sp-t">After</h4><pre className="json">{JSON.stringify(l.new_values, null, 2)}</pre></>}
      <h4 className="sp-t">Additional Information</h4><div className="kv"><span>Record ID</span><b>{l.record_id || "-"}</b></div><div className="kv"><span>Log ID</span><b>{l.id}</b></div>
      <p className="note">Audit logs are append-only and cannot be edited or deleted from the app.</p>
    </div>
  );
}

export default function Audit() {
  const { toast } = useUI();
  const { search } = useShell();
  const [f, setF] = useState({ ...preset("month"), user: "all", module: "all", action: "all", level: "all" });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(null);
  const dq = useDebounced(search);
  const d = useFetch("/audit-logs", { ...f, q: dq, page, limit: 10 });
  useEffect(() => setPage(1), [f, dq]);
  const s = d.data?.summary, fl = d.data?.filters;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const exportCsv = async () => { try { const r = await api("/audit-logs", { params: { ...f, q: dq, limit: 5000 } }); saveCSV("audit-logs.csv", r.logs, [{ label: "Date & Time", get: (l) => fmtDT(l.created_at) }, { label: "User", key: "user_name" }, { label: "Action", key: "action" }, { label: "Module", key: "module" }, { label: "Details", key: "details" }, { label: "IP", key: "ip" }, { label: "Level", key: "level" }]); } catch (e) { toast(e.message, "err"); } };
  return (
    <div className={`page split ${sel ? "has-panel" : ""}`}>
      <div className="split-main">
        <div className="ph"><div><h1>Audit Logs / Activity Logs</h1><p className="muted">Track all system activities, user actions and data changes for better security and monitoring</p></div><button className="btn" onClick={exportCsv}>⭳ Export Logs</button></div>
        <div className="kpis"><Stat icon="📄" label="Total Logs" value={num(s?.total)} tone="amber" /><Stat icon="👤" label="Active Users" value={num(s?.active_users)} tone="blue" /><Stat icon="🛡️" label="Critical Actions" value={num(s?.critical)} tone="red" /><Stat icon="🗄️" label="Data Changes" value={num(s?.changes)} tone="purple" /></div>
        <div className="filters"><RangePicker from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} presets={false} />
          <select value={f.user} onChange={set("user")}><option value="all">All Users</option>{(fl?.users || []).map((u) => <option key={u}>{u}</option>)}</select>
          <select value={f.module} onChange={set("module")}><option value="all">All Modules</option>{(fl?.modules || []).map((u) => <option key={u}>{u}</option>)}</select>
          <select value={f.action} onChange={set("action")}><option value="all">All Actions</option>{(fl?.actions || []).map((u) => <option key={u}>{u}</option>)}</select>
          <select value={f.level} onChange={set("level")}><option value="all">All Levels</option><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></div>
        <section className="card"><div className="table-wrap">
          {d.error && !d.data ? <ErrorBox msg={d.error} retry={d.reloadFull} /> : !d.data ? <Loading /> : !d.data.logs.length ? <Empty icon="🕒" text="No log entries for these filters." /> : (
            <table className="tbl"><thead><tr><th>#</th><th>Date & Time</th><th>User</th><th>Action</th><th>Module</th><th>Details</th><th>IP Address</th><th>Level</th></tr></thead>
              <tbody>{d.data.logs.map((l, i) => <tr key={l.id} className={sel === l.id ? "sel" : ""} onClick={() => setSel(l.id)}><td>{(page - 1) * 10 + i + 1}</td><td>{fmtDT(l.created_at)}</td><td><Avatar name={l.user_name} size={24} /> {l.user_name || "System"}</td><td><Badge kind="green">{l.action}</Badge></td><td><Badge kind="amber">{l.module}</Badge></td><td className="wrap">{l.details}</td><td>{String(l.ip || "-").replace("::ffff:", "")}</td><td><Badge v={l.level} /></td></tr>)}</tbody></table>)}</div>
          {d.data && <Pager page={page} total={d.data.total} limit={10} onPage={setPage} label="logs" />}</section>
      </div>
      {sel && <Detail id={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

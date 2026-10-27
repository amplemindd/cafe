import React, { useEffect, useState } from "react";
import { api, cap, fmtDT } from "../lib/api";
import { useAuth, useFetch, useUI } from "../lib/store";
import { Avatar, Badge, ErrorBox, Field, Loading, Modal, Panel, Tabs, Toggle } from "../lib/ui";

const blank = { name: "", email: "", phone: "", role: "cashier", password: "", is_active: true };

export default function Users() {
  const { user } = useAuth();
  const { toast, ask } = useUI();
  const users = useFetch("/users");
  const roles = useFetch("/roles");
  const [tab, setTab] = useState("users");
  const [form, setForm] = useState(null);
  const [role, setRole] = useState("manager");
  const [perms, setPerms] = useState([]);
  const rl = roles.data?.roles || [];
  useEffect(() => { const r = rl.find((x) => x.name === role); if (r) setPerms(r.permissions); }, [roles.data, role]); // eslint-disable-line
  const save = async () => {
    try { await api(form.id ? `/users/${form.id}` : "/users", { method: form.id ? "PUT" : "POST", body: form }); toast("User saved."); setForm(null); users.reload(); }
    catch (e) { toast(e.message, "err"); }
  };
  const savePerms = async () => { try { await api(`/roles/${role}`, { method: "PUT", body: { permissions: perms } }); toast("Permissions saved."); roles.reload(); } catch (e) { toast(e.message, "err"); } };
  const addRole = async () => { const name = await ask("Name of the new role (letters and numbers):", { input: true, okText: "Create", title: "New role" }); if (name) try { await api("/roles", { method: "POST", body: { name } }); roles.reload(); setRole(name.toLowerCase().replace(/[^a-z0-9_-]/g, "")); } catch (e) { toast(e.message, "err"); } };
  const up = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  if (users.error && !users.data) return <div className="page"><ErrorBox msg={users.error} retry={users.reloadFull} /></div>;
  return (
    <div className="page">
      <div className="ph"><div><h1>Staff / Users</h1><p className="muted">Create staff accounts and control what each role can do. Permissions are enforced by the server.</p></div>{tab === "users" && <button className="btn pri" onClick={() => setForm({ ...blank })}>＋ Add User</button>}</div>
      <Tabs value={tab} onChange={setTab} items={[["users", "Users"], ["roles", "Roles & Permissions"]]} />
      {tab === "users" && <section className="card"><div className="table-wrap">{!users.data ? <Loading /> : (
        <table className="tbl"><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Role</th><th>Last login</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{users.data.users.map((u, i) => <tr key={u.id}><td>{i + 1}</td><td><Avatar name={u.name} size={28} /> <b>{u.name}</b>{u.id === user.id && <small className="muted"> (you)</small>}</td><td>{u.email}</td><td><Badge kind="green">{cap(u.role)}</Badge></td><td>{u.last_login ? fmtDT(u.last_login) : "Never"}</td><td><Badge kind={u.is_active ? "green" : "gray"}>{u.is_active ? "Active" : "Disabled"}</Badge></td>
            <td><button className="btn sm" onClick={() => setForm({ ...blank, ...u, phone: u.phone || "", password: "", is_active: !!u.is_active })}>✎ Edit</button></td></tr>)}</tbody></table>)}</div></section>}
      {tab === "roles" && (!roles.data ? <Loading /> : (
        <Panel title="Roles & Permissions" right={<button className="btn sm" onClick={addRole}>＋ New role</button>}>
          <div className="tabs">{rl.map((r) => <button key={r.name} className={`tab ${role === r.name ? "on" : ""}`} onClick={() => setRole(r.name)}>{cap(r.name)}</button>)}</div>
          {role === "admin" && <p className="note">The admin role always has full access.</p>}
          <div className="perm-grid">{roles.data.permissions.map((p) => <label key={p.key} className="perm"><input type="checkbox" disabled={role === "admin"} checked={perms.includes(p.key)} onChange={(e) => setPerms(e.target.checked ? [...perms, p.key] : perms.filter((x) => x !== p.key))} /> {p.label}</label>)}</div>
          {role === "cashier" && <p className="note">The cashier role is also used by the public POS screen (no login). Keep it limited.</p>}
          <div className="sp-actions"><button className="btn pri" disabled={role === "admin"} onClick={savePerms}>Save Permissions</button></div></Panel>))}
      {form && (
        <Modal title={form.id ? "Edit User" : "Add User"} onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn pri" onClick={save}>Save User</button></>}>
          <Field label="Full name" req><input value={form.name} maxLength={100} onChange={up("name")} /></Field>
          <div className="two"><Field label="Email" req><input type="email" value={form.email} onChange={up("email")} /></Field><Field label="Phone"><input value={form.phone} onChange={up("phone")} /></Field></div>
          <div className="two"><Field label="Role"><select value={form.role} onChange={up("role")}>{rl.map((r) => <option key={r.name} value={r.name}>{cap(r.name)}</option>)}</select></Field>
            <Field label={form.id ? "New password (optional)" : "Password"} req={!form.id} hint="At least 8 characters"><input type="password" autoComplete="new-password" value={form.password} onChange={up("password")} /></Field></div>
          <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Account active" />
        </Modal>
      )}
    </div>
  );
}

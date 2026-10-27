import React, { useEffect, useState } from "react";
import { A, navigate, useAuth } from "../lib/store";
import { img } from "../lib/api";

export default function Login() {
  const { login, isStaff, settings } = useAuth();
  const [f, setF] = useState({ email: "", password: "" });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isStaff) navigate("/admin-dashboard"); }, [isStaff]);
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { const u = await login(f.email, f.password); navigate(u.role === "cashier" ? "/" : "/admin-dashboard"); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">{settings.logo_url ? <img src={img(settings.logo_url)} alt="" /> : <span>☕</span>}<h2>{settings.restaurant_name || "Brew & Bite"}</h2></div>
        <h1>Admin / Staff Login</h1>
        <p className="muted">Sign in to manage your café.</p>
        <label className="fld"><span>Email address</span><input type="email" required autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Enter your email" /></label>
        <label className="fld"><span>Password</span>
          <div className="pw"><input type={show ? "text" : "password"} required autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Enter your password" />
            <button type="button" className="btn sm" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button></div></label>
        {err && <div className="errbox">⚠ {err}</div>}
        <button className="btn pri block" disabled={busy}>{busy ? "Signing in…" : "Sign In"}</button>
        <A to="/" className="back">← Back to POS</A>
      </form>
    </main>
  );
}

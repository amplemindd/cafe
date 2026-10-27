import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, setToken } from "./api";

/* ---------- tiny router ---------- */
let handoff = null;
export const takeHandoff = () => { const h = handoff; handoff = null; return h; };
export function navigate(to, state) {
  handoff = state || null;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new Event("bbnav"));
  window.scrollTo(0, 0);
}
export function usePath() {
  const [p, setP] = useState(window.location.pathname);
  useEffect(() => {
    const f = () => setP(window.location.pathname);
    window.addEventListener("popstate", f); window.addEventListener("bbnav", f);
    return () => { window.removeEventListener("popstate", f); window.removeEventListener("bbnav", f); };
  }, []);
  return p.replace(/\/+$/, "") || "/";
}
export function A({ to, state, children, onClick, ...rest }) {
  return <a href={to} {...rest} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); if (onClick) onClick(e); navigate(to, state); }}>{children}</a>;
}

/* ---------- toast + confirm/prompt ---------- */
const UICtx = createContext(null);
export const useUI = () => useContext(UICtx);
export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dlg, setDlg] = useState(null);
  const [val, setVal] = useState("");
  const toast = useCallback((msg, type = "ok") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === "err" ? 6000 : 3500);
  }, []);
  const ask = useCallback((msg, opts = {}) => new Promise((resolve) => { setVal(""); setDlg({ msg, ...opts, resolve }); }), []);
  const close = (r) => { dlg.resolve(r); setDlg(null); };
  return (
    <UICtx.Provider value={{ toast, ask }}>
      {children}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.type === "ok" ? "✓" : "⚠"} {t.msg}</div>)}</div>
      {dlg && (
        <div className="overlay" onClick={() => close(false)}>
          <div className="modal sm" onClick={(e) => e.stopPropagation()}>
            <h3>{dlg.title || "Please confirm"}</h3>
            <p className="muted">{dlg.msg}</p>
            {dlg.input && <input autoFocus value={val} placeholder={dlg.placeholder || ""} onChange={(e) => setVal(e.target.value)} />}
            <div className="row-end">
              <button className="btn" onClick={() => close(false)}>Cancel</button>
              <button className={dlg.danger ? "btn dng" : "btn pri"} onClick={() => close(dlg.input ? val : true)}>{dlg.okText || "Confirm"}</button>
            </div>
          </div>
        </div>
      )}
    </UICtx.Provider>
  );
}

/* ---------- auth + settings ---------- */
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);
export function AuthProvider({ children }) {
  const [st, setSt] = useState({ loading: true, user: null, settings: {}, error: "" });
  const refresh = useCallback(async () => {
    try { const d = await api("/auth/me"); setSt({ loading: false, user: d.user, settings: d.settings, error: "" }); }
    catch (e) { setSt((s) => ({ ...s, loading: false, error: e.message })); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = st.settings.dark_mode ? "dark" : "light";
    document.documentElement.style.setProperty("--font", `${st.settings.font || "Poppins"}, system-ui, -apple-system, "Segoe UI", sans-serif`);
  }, [st.settings.dark_mode, st.settings.font]);
  const login = async (email, password) => { const d = await api("/auth/login", { method: "POST", body: { email, password } }); setToken(d.token); await refresh(); return d.user; };
  const logout = async () => { try { await api("/auth/logout", { method: "POST" }); } catch { /* ignore */ } setToken(""); await refresh(); };
  const can = (p) => !!st.user && (st.user.permissions.includes("*") || st.user.permissions.includes(p));
  return <AuthCtx.Provider value={{ ...st, refresh, login, logout, can, isStaff: !!st.user && !st.user.public }}>{children}</AuthCtx.Provider>;
}

/* ---------- shell context (search text, base path) ---------- */
export const ShellCtx = createContext({ search: "", admin: false, base: "", link: (p) => "/" + p, catSel: "", setCatSel: () => {}, bump: 0, reload: () => {} });
export const useShell = () => useContext(ShellCtx);

/* ---------- data hook ---------- */
export function useFetch(path, params, deps = [], interval = 0) {
  const [state, setState] = useState({ data: null, loading: true, error: "" });
  const key = JSON.stringify(params || {}) + path;
  const alive = useRef(true);
  const load = useCallback(async (silent) => {
    if (!path) return;
    if (!silent) setState((s) => ({ ...s, loading: true, error: "" }));
    try { const d = await api(path, { params }); if (alive.current) setState({ data: d, loading: false, error: "" }); }
    catch (e) { if (alive.current) setState((s) => ({ ...s, loading: false, error: e.message })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);
  useEffect(() => { if (!interval) return; const t = setInterval(() => load(true), interval); return () => clearInterval(t); }, [load, interval]);
  return { ...state, reload: () => load(true), reloadFull: () => load(false) };
}
export function useDebounced(v, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

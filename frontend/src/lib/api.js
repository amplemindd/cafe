export const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000/api";
export const ORIGIN = API_URL.replace(/\/api\/?$/, "");
const TK = "bbToken";
export const getToken = () => localStorage.getItem(TK) || "";
export const setToken = (t) => (t ? localStorage.setItem(TK, t) : localStorage.removeItem(TK));
export const img = (u) => (!u ? "" : /^https?:|^data:/.test(u) ? u : ORIGIN + u);

export async function api(path, { method = "GET", body, params } = {}) {
  let url = API_URL + path;
  if (params) {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && v !== "" && v !== "all" && p.append(k, v));
    const s = p.toString();
    if (s) url += "?" + s;
  }
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const t = getToken();
  if (t) headers.Authorization = "Bearer " + t;
  let res;
  try { res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch { throw Object.assign(new Error("Cannot connect to the server. Please make sure the backend is running."), { network: true }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw Object.assign(new Error(data.message || `Request failed (${res.status})`), { status: res.status });
  return data;
}
export async function downloadFile(path, filename) {
  const res = await fetch(API_URL + path, { headers: { Authorization: "Bearer " + getToken() } });
  if (!res.ok) throw new Error("Download failed.");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

/* ---------- formatting helpers ---------- */
const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const money = (n) => "₹" + nf.format(Number(n) || 0);
export const num = (n) => nf.format(Number(n) || 0);
export const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toDate = (s) => (s instanceof Date ? s : new Date(String(s).length === 10 ? s + "T00:00:00" : String(s).replace(" ", "T")));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (s) => { if (!s) return "-"; const d = toDate(s); return isNaN(d) ? "-" : `${pad(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
export const fmtTime = (s) => { if (!s) return "-"; const d = toDate(s); if (isNaN(d)) return "-"; const h = d.getHours(); return `${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${h >= 12 ? "PM" : "AM"}`; };
export const fmtDT = (s) => (s ? `${fmtDate(s)}, ${fmtTime(s)}` : "-");
export const ago = (s) => { const m = Math.max(Math.round((Date.now() - toDate(s)) / 60000), 0); if (m < 1) return "just now"; if (m < 60) return `${m} min${m > 1 ? "s" : ""} ago`; const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`; return `${Math.floor(h / 24)} day(s) ago`; };
export const elapsed = (s) => { if (!s) return ""; const m = Math.max(Math.round((Date.now() - toDate(s)) / 60000), 0); return m < 60 ? `${m} mins` : `${Math.floor(m / 60)}h ${m % 60}m`; };
export const TYPES = { dine_in: "Dine In", pickup: "Pick Up", delivery: "Delivery", online: "Online" };
export const TYPE_ICON = { dine_in: "🍽️", pickup: "🛍️", delivery: "🛵", online: "🌐" };
export const cap = (s) => String(s || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const preset = (name) => {
  const t = new Date(), to = ymd(t);
  if (name === "week") { const d = new Date(t); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { from: ymd(d), to }; }
  if (name === "month") return { from: `${to.slice(0, 8)}01`, to };
  return { from: to, to };
};
export function toCSV(rows, cols) {
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map((c) => esc(c.label)).join(","), ...rows.map((r) => cols.map((c) => esc(typeof c.get === "function" ? c.get(r) : r[c.key])).join(","))].join("\n");
}
export function saveCSV(name, rows, cols) {
  const url = URL.createObjectURL(new Blob(["\ufeff" + toCSV(rows, cols)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
export const readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Could not read file.")); r.readAsDataURL(file); });
export const uid = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

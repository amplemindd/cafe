"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const DEFAULTS = require("./defaults");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => new HttpError(status, message);

const q = async (sql, params) => (await pool.query(sql, params))[0];
const one = async (sql, params) => (await q(sql, params))[0] || null;
async function tx(fn) {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); const r = await fn(c); await c.commit(); return r; }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
const cq = async (c, sql, params) => (await c.query(sql, params))[0];

/* ---------- settings (cached) ---------- */
let settingsCache = null, settingsAt = 0;
async function getSettings(force) {
  if (!force && settingsCache && Date.now() - settingsAt < 5000) return settingsCache;
  const rows = await q("SELECT k, v FROM bb_settings");
  const s = { ...DEFAULTS };
  for (const r of rows) { try { s[r.k] = JSON.parse(r.v); } catch { s[r.k] = r.v; } }
  settingsCache = s; settingsAt = Date.now();
  return s;
}
const clearSettingsCache = () => { settingsCache = null; };

/* ---------- auth / permissions ---------- */
const PERMISSIONS = [
  ["pos", "POS / Billing"], ["orders", "View orders"], ["orders.cancel", "Cancel orders / refunds"],
  ["tables", "View tables"], ["tables.manage", "Manage tables"], ["menu", "View menu items"],
  ["menu.manage", "Manage menu items & categories"], ["customers", "View customers"],
  ["customers.manage", "Add / edit customers"], ["reports", "Reports & dashboard"], ["expenses", "Expenses"],
  ["taxes", "Taxes / GST"], ["staff", "Staff & roles"], ["audit", "Audit logs"],
  ["notifications", "Notifications"], ["settings", "Settings"], ["discount", "Apply discounts"], ["backup", "Backup & restore"],
];
const can = (user, perm) => user.perms.includes("*") || user.perms.includes(perm);

async function authenticate(req) {
  const m = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!m || !process.env.JWT_SECRET) return null;
  let payload;
  try { payload = jwt.verify(m[1], process.env.JWT_SECRET, { issuer: "brew-bite-api" }); } catch { return null; }
  const u = await one(
    "SELECT u.id, u.name, u.email, u.role, u.is_active, r.permissions FROM bb_users u LEFT JOIN bb_roles r ON r.name = u.role WHERE u.id = ?",
    [payload.uid]
  );
  if (!u || !u.is_active) return null;
  let perms = [];
  try { perms = JSON.parse(u.permissions || "[]"); } catch { perms = []; }
  if (u.role === "admin") perms = ["*"];
  return { id: u.id, name: u.name, email: u.email, role: u.role, perms };
}
// Public front (no login): acts as the 'cashier' role, limited to that role's permissions.
let pubCache = null, pubAt = 0;
async function publicUser() {
  if (pubCache && Date.now() - pubAt < 5000) return pubCache;
  const S = await getSettings();
  if (S.public_front === false) return null;
  const r = await one("SELECT permissions FROM bb_roles WHERE name = 'cashier'");
  let perms = []; try { perms = JSON.parse((r && r.permissions) || "[]"); } catch { perms = []; }
  pubCache = { id: null, name: "Cashier", email: "", role: "cashier", perms, public: true }; pubAt = Date.now();
  return pubCache;
}
const signToken = (user) =>
  jwt.sign({ uid: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "10h", issuer: "brew-bite-api" });

/* ---------- audit + notifications ---------- */
async function audit(ctx, d, conn = pool) {
  try {
    await conn.query(
      "INSERT INTO bb_audit (user_id, user_name, action, module, details, record_id, old_values, new_values, ip, user_agent, level) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [ctx?.user?.id || null, ctx?.user?.name || d.user_name || "System", d.action, d.module, String(d.details || "").slice(0, 500),
        d.record_id == null ? null : String(d.record_id), d.old ? JSON.stringify(d.old) : null, d.neu ? JSON.stringify(d.neu) : null,
        ctx?.ip || null, String(ctx?.req?.headers?.["user-agent"] || "").slice(0, 250), d.level || "info"]
    );
  } catch (e) { console.error("Audit log failed:", e.message); }
}

const NOTIFY_PREF = { order: "n_new_order", payment: "n_payment", inventory: "n_low_stock", table: "n_table", report: "n_daily_report", expense: "n_expense", system: "n_system" };
async function notify(d, conn = pool) {
  try {
    const S = await getSettings();
    if (NOTIFY_PREF[d.type] && S[NOTIFY_PREF[d.type]] === false) return;
    await conn.query(
      "INSERT IGNORE INTO bb_notifications (type, title, message, priority, link_type, link_id, dedupe_key) VALUES (?,?,?,?,?,?,?)",
      [d.type, d.title, d.message || "", d.priority || "normal", d.link_type || null, d.link_id == null ? null : String(d.link_id), d.dedupe || null]
    );
  } catch (e) { console.error("Notification failed:", e.message); }
}

/* ---------- uploads (optional images) ---------- */
const MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };
function saveUpload(dataUrl, { allowPdf = false, maxBytes = 2 * 1024 * 1024 } = {}) {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(dataUrl || ""));
  if (!m || !MIME[m[1]] || (m[1] === "application/pdf" && !allowPdf)) throw fail(400, "Unsupported file type. Use JPG, PNG or WebP" + (allowPdf ? " (or PDF)." : "."));
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length || buf.length > maxBytes) throw fail(400, `File is too large (max ${Math.round(maxBytes / 1048576)} MB).`);
  const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${MIME[m[1]]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}
function removeUpload(url) {
  try {
    if (!url || !String(url).startsWith("/uploads/")) return;
    const file = path.join(UPLOAD_DIR, path.basename(url));
    if (file.startsWith(UPLOAD_DIR) && fs.existsSync(file)) fs.unlinkSync(file);
  } catch { /* ignore */ }
}

/* ---------- misc helpers ---------- */
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
function dateRange(query) {
  const t = ymd();
  let from = isYmd(query.from) ? query.from : t, to = isYmd(query.to) ? query.to : from;
  if (to < from) [from, to] = [to, from];
  return { from, to };
}
function paging(query, def = 10, max = 100000) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || def, 1), max);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}
const like = (s) => `%${String(s).replace(/[%_\\]/g, "\\$&")}%`;
const str = (v, max = 255) => String(v ?? "").trim().slice(0, max);
const bool = (v, d = 0) => (v === undefined || v === null ? d : v === true || v === 1 || v === "1" || v === "true" ? 1 : 0);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/* ---------- router ---------- */
const routes = [];
function add(method, pattern, perm, handler) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ method, re, keys, perm, handler });
}
const api = { get: (...a) => add("GET", ...a), post: (...a) => add("POST", ...a), put: (...a) => add("PUT", ...a), patch: (...a) => add("PATCH", ...a), delete: (...a) => add("DELETE", ...a) };

function send(res, status, data, headers = {}) {
  if (res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(data));
}
async function readBody(req, limit = 9 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw fail(413, "Request is too large."); chunks.push(c); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw fail(400, "Invalid JSON in request."); }
}

async function dispatch(req, res, url) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), user: null, body: {}, ip: req.socket.remoteAddress };
    if (r.perm) {
      ctx.user = process.env.JWT_SECRET ? await authenticate(req) : null;
      if (!ctx.user) { const pu = await publicUser(); if (pu && (r.perm === "auth" || can(pu, r.perm))) ctx.user = pu; }
      if (!ctx.user) throw fail(401, "Please sign in to continue.");
      if (r.perm !== "auth" && !can(ctx.user, r.perm)) throw fail(ctx.user.public ? 401 : 403, ctx.user.public ? "Please sign in as staff to do this." : "You do not have permission to do this.");
    }
    if (["POST", "PUT", "PATCH"].includes(req.method)) ctx.body = await readBody(req);
    const result = await r.handler(ctx);
    if (result !== undefined) { const { __status, ...rest } = result; send(res, __status || 200, { success: true, ...rest }); }
    return true;
  }
  return false;
}

module.exports = { pool, q, one, tx, cq, fail, HttpError, getSettings, clearSettingsCache, PERMISSIONS, can, authenticate, signToken,
  audit, notify, saveUpload, removeUpload, UPLOAD_DIR, r2, ymd, isYmd, dateRange, paging, like, str, bool, num, api, send, dispatch };

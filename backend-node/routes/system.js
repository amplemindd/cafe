"use strict";
// Notifications, Audit logs, Settings, Backup & restore
const fs = require("fs");
const path = require("path");
const { api, q, one, tx, fail, audit, notify, paging, like, str, isYmd, dateRange, getSettings, clearSettingsCache, saveUpload, removeUpload, pool, send } = require("../lib/core");
const DEFAULTS = require("../lib/defaults");

/* ================= NOTIFICATIONS ================= */
function nWhere(Q) {
  const w = ["is_archived = 0"], p = [];
  if (Q.type && Q.type !== "all") { w.push("type = ?"); p.push(Q.type); }
  if (Q.status === "unread") w.push("is_read = 0"); if (Q.status === "read") w.push("is_read = 1");
  if (Q.q) { w.push("(title LIKE ? OR message LIKE ?)"); p.push(like(Q.q), like(Q.q)); }
  if (Q.time === "today") w.push("DATE(created_at) = CURDATE()");
  if (Q.time === "week") w.push("created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
  if (Q.time === "month") w.push("created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
  return { w: w.join(" AND "), p };
}
api.get("/api/notifications", "notifications", async (ctx) => {
  const { w, p } = nWhere(ctx.query), { limit, offset } = paging(ctx.query, 10, 200);
  const [{ total }] = await q(`SELECT COUNT(*) total FROM bb_notifications WHERE ${w}`, p);
  const rows = await q(`SELECT * FROM bb_notifications WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, [...p, limit, offset]);
  const unread = await q("SELECT type, COUNT(*) n FROM bb_notifications WHERE is_archived = 0 AND is_read = 0 GROUP BY type");
  const days = await q("SELECT DATE(created_at) d, COUNT(*) n FROM bb_notifications WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY d");
  return { notifications: rows, total, unread_by_type: Object.fromEntries(unread.map((u) => [u.type, u.n])), unread_total: unread.reduce((s, u) => s + u.n, 0),
    last7: days.map((d) => ({ date: String(d.d).slice(0, 10), n: d.n })) };
});
api.get("/api/notifications/unread-count", "notifications", async () => { const [r] = await q("SELECT COUNT(*) n FROM bb_notifications WHERE is_read = 0 AND is_archived = 0"); return { count: r.n }; });
api.post("/api/notifications/read-all", "notifications", async () => { await q("UPDATE bb_notifications SET is_read = 1 WHERE is_read = 0"); return { message: "All notifications marked as read." }; });
api.patch("/api/notifications/:id/read", "notifications", async (ctx) => { await q("UPDATE bb_notifications SET is_read = 1 WHERE id = ?", [Number(ctx.params.id)]); return {}; });
api.delete("/api/notifications/:id", "notifications", async (ctx) => { await q("UPDATE bb_notifications SET is_archived = 1 WHERE id = ?", [Number(ctx.params.id)]); return { message: "Notification removed." }; });

/* ================= AUDIT LOGS (append-only) ================= */
function aWhere(Q) {
  const w = ["1=1"], p = [];
  if (isYmd(Q.from)) { w.push("DATE(created_at) >= ?"); p.push(Q.from); }
  if (isYmd(Q.to)) { w.push("DATE(created_at) <= ?"); p.push(Q.to); }
  if (Q.user && Q.user !== "all") { w.push("user_name = ?"); p.push(Q.user); }
  if (Q.module && Q.module !== "all") { w.push("module = ?"); p.push(Q.module); }
  if (Q.action && Q.action !== "all") { w.push("action = ?"); p.push(Q.action); }
  if (Q.level && Q.level !== "all") { w.push("level = ?"); p.push(Q.level); }
  if (Q.q) { w.push("(details LIKE ? OR user_name LIKE ? OR module LIKE ?)"); p.push(like(Q.q), like(Q.q), like(Q.q)); }
  return { w: w.join(" AND "), p };
}
api.get("/api/audit-logs", "audit", async (ctx) => {
  const { w, p } = aWhere(ctx.query), { limit, offset } = paging(ctx.query, 10, 100000);
  const [{ total }] = await q(`SELECT COUNT(*) total FROM bb_audit WHERE ${w}`, p);
  const rows = await q(`SELECT id, user_id, user_name, action, module, details, record_id, ip, level, created_at FROM bb_audit WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, [...p, limit, offset]);
  const [s] = await q(`SELECT COUNT(*) total, COUNT(DISTINCT user_name) users, SUM(level = 'critical') critical, SUM(action IN ('Created','Updated','Deleted','Added','Cancelled')) changes FROM bb_audit WHERE ${w}`, p);
  const users = await q("SELECT DISTINCT user_name FROM bb_audit WHERE user_name IS NOT NULL ORDER BY user_name");
  const modules = await q("SELECT DISTINCT module FROM bb_audit ORDER BY module");
  const actions = await q("SELECT DISTINCT action FROM bb_audit ORDER BY action");
  return { logs: rows, total, summary: { total: s.total, active_users: s.users, critical: Number(s.critical || 0), changes: Number(s.changes || 0) }, filters: { users: users.map((x) => x.user_name), modules: modules.map((x) => x.module), actions: actions.map((x) => x.action) } };
});
api.get("/api/audit-logs/:id", "audit", async (ctx) => {
  const l = await one("SELECT * FROM bb_audit WHERE id = ?", [Number(ctx.params.id)]);
  if (!l) throw fail(404, "Log not found.");
  const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
  return { log: { ...l, old_values: parse(l.old_values), new_values: parse(l.new_values) } };
});

/* ================= SETTINGS ================= */
api.get("/api/settings", "auth", async () => ({ settings: await getSettings(true) }));
api.put("/api/settings", "settings", async (ctx) => {
  const incoming = ctx.body.settings || {}, old = await getSettings(true), changed = {};
  const rows = [];
  for (const [k, v] of Object.entries(incoming)) {
    if (!(k in DEFAULTS) || k === "logo_url" || k === "qr_image_url") continue;
    const t = typeof DEFAULTS[k];
    let val = v;
    if (t === "boolean") val = v === true || v === "true" || v === 1;
    else if (t === "number") { val = Number(v); if (!Number.isFinite(val) || val < 0) throw fail(400, `Invalid value for ${k}.`); }
    else val = String(v ?? "").slice(0, 600);
    if (["tax_mode"].includes(k) && !["inclusive", "exclusive"].includes(val)) throw fail(400, "Tax mode must be inclusive or exclusive.");
    if (k === "round_off" && !["none", "nearest1"].includes(val)) throw fail(400, "Invalid rounding option.");
    if (k === "bill_start" && val < 1) throw fail(400, "Bill start number must be at least 1.");
    if (JSON.stringify(old[k]) !== JSON.stringify(val)) changed[k] = { from: old[k], to: val };
    rows.push([k, JSON.stringify(val)]);
  }
  if (incoming.logo_data) { const u = saveUpload(incoming.logo_data); removeUpload(old.logo_url); rows.push(["logo_url", JSON.stringify(u)]); changed.logo_url = { to: u }; }
  if (incoming.remove_logo) { removeUpload(old.logo_url); rows.push(["logo_url", '""']); changed.logo_url = { to: "" }; }
  if (incoming.qr_data) { const u = saveUpload(incoming.qr_data); removeUpload(old.qr_image_url); rows.push(["qr_image_url", JSON.stringify(u)]); changed.qr_image_url = { to: u }; }
  if (incoming.remove_qr) { removeUpload(old.qr_image_url); rows.push(["qr_image_url", '""']); changed.qr_image_url = { to: "" }; }
  if (rows.length) await q("INSERT INTO bb_settings (k, v) VALUES ? ON DUPLICATE KEY UPDATE v = VALUES(v)", [rows]);
  if (incoming.bill_start && Number(incoming.bill_start) > 0 && "bill_start" in changed) await q("UPDATE bb_sequences SET value = GREATEST(value, ?) WHERE name = 'bill'", [Number(incoming.bill_start) - 1]);
  clearSettingsCache();
  if (Object.keys(changed).length) await audit(ctx, { action: "Updated", module: "Settings", details: `Changed settings: ${Object.keys(changed).join(", ")}`.slice(0, 480), old: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])), neu: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])), level: "warning" });
  return { settings: await getSettings(true), message: "Settings saved." };
});

/* ================= BACKUP & RESTORE (JSON snapshot of the business data) ================= */
const BACKUP_DIR = path.join(__dirname, "..", "backups");
const TABLES = ["bb_settings", "bb_roles", "bb_tax_rates", "categories", "products", "bb_tables", "bb_customers", "bb_loyalty_tx", "bb_sequences", "bb_expense_categories", "bb_expenses", "bb_orders", "bb_order_items", "bb_payments", "bb_notifications"];
fs.mkdirSync(BACKUP_DIR, { recursive: true });

async function createBackup(who) {
  const data = { version: 1, created_at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) data.tables[t] = await q(`SELECT * FROM \`${t}\``);
  const filename = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const text = JSON.stringify(data);
  fs.writeFileSync(path.join(BACKUP_DIR, filename), text);
  const r = (await pool.query("INSERT INTO bb_backups (filename, size, created_by) VALUES (?,?,?)", [filename, Buffer.byteLength(text), who]))[0];
  const S = await getSettings();
  const old = await q("SELECT id, filename FROM bb_backups WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)", [Math.max(S.backup_retention, 1)]);
  for (const b of old) { try { fs.unlinkSync(path.join(BACKUP_DIR, path.basename(b.filename))); } catch { /* ignore */ } await q("DELETE FROM bb_backups WHERE id = ?", [b.id]); }
  return { id: r.insertId, filename };
}
api.get("/api/backups", "backup", async () => ({ backups: await q("SELECT id, filename, size, created_by, created_at FROM bb_backups ORDER BY id DESC LIMIT 50") }));
api.post("/api/backups", "backup", async (ctx) => {
  const b = await createBackup(ctx.user.name);
  await audit(ctx, { action: "Backup", module: "System", details: `Created backup ${b.filename}`, level: "warning" });
  return { __status: 201, message: "Backup created.", ...b };
});
api.get("/api/backups/:id/download", "backup", async (ctx) => {
  const b = await one("SELECT * FROM bb_backups WHERE id = ?", [Number(ctx.params.id)]);
  const file = b && path.join(BACKUP_DIR, path.basename(b.filename));
  if (!b || !fs.existsSync(file)) throw fail(404, "Backup file not found.");
  await audit(ctx, { action: "Backup", module: "System", details: `Downloaded backup ${b.filename}`, level: "warning" });
  ctx.res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${b.filename}"` });
  ctx.res.end(fs.readFileSync(file));
});
api.post("/api/backups/:id/restore", "backup", async (ctx) => {
  if (ctx.body.confirm !== "RESTORE") throw fail(400, 'Type RESTORE to confirm.');
  const b = await one("SELECT * FROM bb_backups WHERE id = ?", [Number(ctx.params.id)]);
  const file = b && path.join(BACKUP_DIR, path.basename(b.filename));
  if (!b || !fs.existsSync(file)) throw fail(404, "Backup file not found.");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  await audit(ctx, { action: "Restore", module: "System", details: `Restoring backup ${b.filename}`, level: "critical" });
  await tx(async (c) => {
    await c.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of TABLES) {
      if (!data.tables[t]) continue;
      await c.query(`DELETE FROM \`${t}\``);
      const rows = data.tables[t];
      for (let i = 0; i < rows.length; i += 200) {
        const part = rows.slice(i, i + 200), cols = Object.keys(part[0]);
        await c.query(`INSERT INTO \`${t}\` (${cols.map((x) => `\`${x}\``).join(",")}) VALUES ?`, [part.map((r) => cols.map((k) => r[k]))]);
      }
    }
    await c.query("SET FOREIGN_KEY_CHECKS = 1");
  });
  clearSettingsCache();
  return { message: "Backup restored. Please sign in again if your account changed." };
});

// optional automatic backup (checked every hour)
function startAutoBackup() {
  setInterval(async () => {
    try {
      const S = await getSettings(true);
      if (!S.backup_auto) return;
      const hours = S.backup_frequency === "weekly" ? 168 : 24;
      const [l] = await q("SELECT TIMESTAMPDIFF(HOUR, MAX(created_at), NOW()) h FROM bb_backups");
      if (l.h === null || l.h >= hours) await createBackup("Auto backup");
    } catch (e) { console.error("Auto backup failed:", e.message); }
  }, 60 * 60 * 1000).unref();
}
module.exports = { startAutoBackup };

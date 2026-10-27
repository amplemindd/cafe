"use strict";
const bcrypt = require("bcryptjs");
const { api, q, one, fail, audit, signToken, PERMISSIONS, str, bool, getSettings } = require("../lib/core");

const attempts = new Map(); // simple brute-force protection: 6 failures / 15 min per email+ip
function tooMany(key) { const a = attempts.get(key); return a && a.n >= 6 && Date.now() - a.t < 15 * 60 * 1000; }
function failed(key) { const a = attempts.get(key); attempts.set(key, a && Date.now() - a.t < 15 * 60 * 1000 ? { n: a.n + 1, t: a.t } : { n: 1, t: Date.now() }); }

api.post("/api/auth/login", null, async (ctx) => {
  const email = str(ctx.body.email, 150).toLowerCase();
  const password = String(ctx.body.password || "");
  if (!email || !password) throw fail(400, "Email and password are required.");
  const key = `${email}|${ctx.ip}`;
  if (tooMany(key)) throw fail(429, "Too many failed attempts. Please try again in 15 minutes.");
  const u = await one("SELECT u.*, r.permissions FROM bb_users u LEFT JOIN bb_roles r ON r.name = u.role WHERE u.email = ?", [email]);
  const ok = u && u.is_active && (await bcrypt.compare(password, u.password_hash));
  if (!ok) {
    failed(key);
    await audit({ ip: ctx.ip, req: ctx.req }, { action: "Failed", module: "System", details: `Failed login attempt for ${email}`, level: "warning", user_name: email });
    throw fail(401, "Invalid email or password.");
  }
  attempts.delete(key);
  await q("UPDATE bb_users SET last_login = NOW() WHERE id = ?", [u.id]);
  const user = { id: u.id, name: u.name, email: u.email, role: u.role };
  await audit({ user, ip: ctx.ip, req: ctx.req }, { action: "Login", module: "System", details: "User login successful" });
  return { token: signToken(user), user: { ...user, permissions: u.role === "admin" ? ["*"] : JSON.parse(u.permissions || "[]") } };
});

api.post("/api/auth/logout", "auth", async (ctx) => {
  await audit(ctx, { action: "Logout", module: "System", details: "User logout" });
  return {};
});

api.get("/api/auth/me", "auth", async (ctx) => ({ user: { ...ctx.user, permissions: ctx.user.perms }, settings: await getSettings() }));

/* ---------- users ---------- */
api.get("/api/users", "staff", async () => ({
  users: await q("SELECT id, name, email, phone, role, is_active, last_login, created_at FROM bb_users ORDER BY id"),
}));

function validUser(b, creating) {
  const name = str(b.name, 100), email = str(b.email, 150).toLowerCase(), phone = str(b.phone, 30);
  if (!name) throw fail(400, "Name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(400, "Enter a valid email address.");
  if (creating && String(b.password || "").length < 8) throw fail(400, "Password must be at least 8 characters.");
  if (!creating && b.password && String(b.password).length < 8) throw fail(400, "Password must be at least 8 characters.");
  return { name, email, phone: phone || null };
}
async function roleExists(role) { if (!(await one("SELECT name FROM bb_roles WHERE name = ?", [role]))) throw fail(400, "Unknown role."); }

api.post("/api/users", "staff", async (ctx) => {
  const b = ctx.body, v = validUser(b, true);
  const role = str(b.role, 50) || "cashier"; await roleExists(role);
  if (await one("SELECT id FROM bb_users WHERE email = ?", [v.email])) throw fail(409, "A user with this email already exists.");
  const hash = await bcrypt.hash(String(b.password), 10);
  const r = (await q("INSERT INTO bb_users (name, email, phone, password_hash, role, is_active) VALUES (?,?,?,?,?,?)", [v.name, v.email, v.phone, hash, role, bool(b.is_active, 1)]))[0] || {};
  const id = (await one("SELECT id FROM bb_users WHERE email = ?", [v.email])).id;
  await audit(ctx, { action: "Created", module: "Users", details: `Created ${role} account "${v.name}"`, record_id: id, level: "warning" });
  return { __status: 201, id, message: "User created." };
});

api.put("/api/users/:id", "staff", async (ctx) => {
  const id = Number(ctx.params.id), b = ctx.body, v = validUser(b, false);
  const old = await one("SELECT id, name, email, role, is_active FROM bb_users WHERE id = ?", [id]);
  if (!old) throw fail(404, "User not found.");
  const role = str(b.role, 50) || old.role; await roleExists(role);
  const active = bool(b.is_active, old.is_active);
  if (id === ctx.user.id && (!active || role !== old.role)) throw fail(400, "You cannot disable or change the role of your own account.");
  const dup = await one("SELECT id FROM bb_users WHERE email = ? AND id <> ?", [v.email, id]);
  if (dup) throw fail(409, "A user with this email already exists.");
  await q("UPDATE bb_users SET name=?, email=?, phone=?, role=?, is_active=? WHERE id=?", [v.name, v.email, v.phone, role, active, id]);
  if (b.password) await q("UPDATE bb_users SET password_hash = ? WHERE id = ?", [await bcrypt.hash(String(b.password), 10), id]);
  await audit(ctx, { action: "Updated", module: "Users", details: `Updated user "${v.name}"${b.password ? " (password changed)" : ""}`, record_id: id, old, neu: { name: v.name, email: v.email, role, is_active: active }, level: "warning" });
  return { message: "User updated." };
});

/* ---------- roles & permissions ---------- */
api.get("/api/roles", "staff", async () => {
  const rows = await q("SELECT name, permissions, is_system FROM bb_roles ORDER BY is_system DESC, name");
  return { roles: rows.map((r) => ({ name: r.name, is_system: !!r.is_system, permissions: r.name === "admin" ? PERMISSIONS.map((p) => p[0]) : JSON.parse(r.permissions || "[]") })),
    permissions: PERMISSIONS.map(([key, label]) => ({ key, label })) };
});
api.post("/api/roles", "staff", async (ctx) => {
  const name = str(ctx.body.name, 50).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!name) throw fail(400, "Role name is required.");
  if (await one("SELECT name FROM bb_roles WHERE name = ?", [name])) throw fail(409, "Role already exists.");
  await q("INSERT INTO bb_roles (name, permissions) VALUES (?, '[]')", [name]);
  await audit(ctx, { action: "Created", module: "Users", details: `Created role "${name}"`, level: "warning" });
  return { __status: 201, message: "Role created." };
});
api.put("/api/roles/:name", "staff", async (ctx) => {
  const name = ctx.params.name;
  if (name === "admin") throw fail(400, "The admin role always has full access.");
  const valid = new Set(PERMISSIONS.map((p) => p[0]));
  const perms = (Array.isArray(ctx.body.permissions) ? ctx.body.permissions : []).filter((p) => valid.has(p));
  const old = await one("SELECT permissions FROM bb_roles WHERE name = ?", [name]);
  if (!old) throw fail(404, "Role not found.");
  await q("UPDATE bb_roles SET permissions = ? WHERE name = ?", [JSON.stringify(perms), name]);
  await audit(ctx, { action: "Updated", module: "Users", details: `Changed permissions of role "${name}"`, old: JSON.parse(old.permissions), neu: perms, level: "critical" });
  return { message: "Permissions saved." };
});

"use strict";
// Brew & Bite – native Node.js HTTP server (no Express). Run: npm start
require("dotenv").config({ quiet: true });
const http = require("http");
const fs = require("fs");
const path = require("path");
const { migrate } = require("./lib/migrate");
const core = require("./lib/core");
require("./routes/auth");
require("./routes/catalog");
require("./routes/tables");
require("./routes/customers");
require("./routes/orders");
require("./routes/expenses");
require("./routes/reports");
const { startAutoBackup } = require("./routes/system");

const PORT = Number(process.env.PORT) || 5000;
const ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".pdf": "application/pdf" };

function cors(req, res) {
  const o = req.headers.origin;
  const allowed = o && (o === ORIGIN || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o));
  res.setHeader("Access-Control-Allow-Origin", allowed ? o : ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
      const file = path.join(core.UPLOAD_DIR, path.basename(url.pathname));
      if (!file.startsWith(core.UPLOAD_DIR) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "public, max-age=86400", "Cross-Origin-Resource-Policy": "cross-origin" });
      return fs.createReadStream(file).pipe(res);
    }
    if (url.pathname === "/api/health") return core.send(res, 200, { success: true, status: "ok" });
    if (url.pathname.startsWith("/api/")) {
      const handled = await core.dispatch(req, res, url);
      if (!handled) core.send(res, 404, { success: false, message: "API route not found." });
      return;
    }
    core.send(res, 404, { success: false, message: "Not found." });
  } catch (e) {
    if (e instanceof core.HttpError) return core.send(res, e.status, { success: false, message: e.message });
    console.error(`${req.method} ${url.pathname} failed:`, e.code || "", e.message);
    const db = /ECONNREFUSED|ER_ACCESS_DENIED|ER_BAD_DB|ENOTFOUND|ER_NO_SUCH_TABLE/.test(`${e.code} ${e.message}`);
    core.send(res, 500, { success: false, message: db ? "Database is not reachable. Check backend-node/.env and that MySQL is running." : "Something went wrong on the server." });
  }
});

(async () => {
  if (!process.env.JWT_SECRET) console.warn("JWT_SECRET is missing in backend-node/.env – staff login is disabled until you set it (public POS still works).");
  try { await migrate(); console.log("Database ready."); }
  catch (e) { console.error("Database setup failed:", e.code || "", e.message, "\nCheck DB_* values in backend-node/.env and that MySQL is running."); }
  startAutoBackup();
  server.listen(PORT, () => console.log(`Brew & Bite API running at http://localhost:${PORT}`));
})();

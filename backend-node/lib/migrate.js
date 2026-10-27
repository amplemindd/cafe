"use strict";
// Creates / upgrades all tables automatically at startup. Existing `categories` and `products`
// tables (and your data) are kept; new columns are added. New tables use the `bb_` prefix so they
// never clash with any older tables in your database.
const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const DEFAULTS = require("./defaults");
const { PERMISSIONS } = require("./core");

const q = async (sql, p) => (await pool.query(sql, p))[0];

async function hasColumn(table, col) {
  const r = await q("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1", [table, col]);
  return r.length > 0;
}
async function addColumn(table, col, def) { if (!(await hasColumn(table, col))) await q(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`); }

const DDL = [
  `CREATE TABLE IF NOT EXISTS bb_roles (name VARCHAR(50) PRIMARY KEY, permissions TEXT NOT NULL, is_system TINYINT NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS bb_users (
    id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(150) NOT NULL UNIQUE, phone VARCHAR(30) NULL,
    password_hash VARCHAR(100) NOT NULL, role VARCHAR(50) NOT NULL DEFAULT 'cashier', is_active TINYINT NOT NULL DEFAULT 1,
    last_login DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS bb_settings (k VARCHAR(100) PRIMARY KEY, v TEXT NULL)`,
  `CREATE TABLE IF NOT EXISTS bb_tax_rates (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(60) NOT NULL, rate DECIMAL(5,2) NOT NULL,
    description VARCHAR(200) NULL, is_active TINYINT NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS bb_tables (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) NOT NULL UNIQUE, capacity INT NOT NULL DEFAULT 4,
    status VARCHAR(20) NOT NULL DEFAULT 'available', status_since DATETIME NULL, reserved_for VARCHAR(100) NULL, reserved_phone VARCHAR(30) NULL,
    reserved_at DATETIME NULL, sort_order INT NOT NULL DEFAULT 0, is_active TINYINT NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS bb_customers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, phone VARCHAR(20) NULL UNIQUE,
    email VARCHAR(150) NULL, address VARCHAR(255) NULL, birthday DATE NULL, notes VARCHAR(500) NULL, status VARCHAR(10) NOT NULL DEFAULT 'active',
    loyalty_points INT NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS bb_loyalty_tx (id INT AUTO_INCREMENT PRIMARY KEY, customer_id INT NOT NULL, order_id INT NULL, points INT NOT NULL,
    type VARCHAR(20) NOT NULL, note VARCHAR(200) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX (customer_id))`,
  `CREATE TABLE IF NOT EXISTS bb_sequences (name VARCHAR(50) PRIMARY KEY, value BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bb_orders (
    id INT AUTO_INCREMENT PRIMARY KEY, bill_no VARCHAR(30) NOT NULL UNIQUE, order_type VARCHAR(20) NOT NULL DEFAULT 'dine_in',
    table_id INT NULL, table_name VARCHAR(50) NULL, customer_id INT NULL, customer_name VARCHAR(100) NOT NULL DEFAULT 'Walk-in',
    customer_phone VARCHAR(30) NULL, delivery_address VARCHAR(255) NULL, guests INT NOT NULL DEFAULT 1, notes VARCHAR(255) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
    subtotal DECIMAL(10,2) NOT NULL DEFAULT 0, discount_type VARCHAR(10) NULL, discount_value DECIMAL(10,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0, discount_by INT NULL, taxable_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(10,2) NOT NULL DEFAULT 0, round_off DECIMAL(10,2) NOT NULL DEFAULT 0, total DECIMAL(10,2) NOT NULL DEFAULT 0,
    tax_mode VARCHAR(12) NOT NULL DEFAULT 'exclusive', created_by INT NULL, idempotency_key VARCHAR(64) NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NULL, paid_at DATETIME NULL, completed_at DATETIME NULL,
    cancel_reason VARCHAR(255) NULL, cancelled_by INT NULL, cancelled_at DATETIME NULL,
    INDEX idx_status (status, payment_status), INDEX idx_paid (paid_at), INDEX idx_created (created_at), INDEX idx_table (table_id))`,
  `CREATE TABLE IF NOT EXISTS bb_order_items (
    id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, product_id INT NULL, product_name VARCHAR(150) NOT NULL, category_name VARCHAR(100) NULL,
    unit_price DECIMAL(10,2) NOT NULL, qty INT NOT NULL, line_subtotal DECIMAL(10,2) NOT NULL, discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    taxable DECIMAL(10,2) NOT NULL DEFAULT 0, tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0, tax_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    line_total DECIMAL(10,2) NOT NULL, INDEX (order_id), INDEX (product_id))`,
  `CREATE TABLE IF NOT EXISTS bb_payments (
    id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, method VARCHAR(20) NOT NULL, amount DECIMAL(10,2) NOT NULL, reference VARCHAR(100) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'paid', created_by INT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX (order_id))`,
  `CREATE TABLE IF NOT EXISTS bb_expense_categories (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS bb_expenses (
    id INT AUTO_INCREMENT PRIMARY KEY, expense_date DATE NOT NULL, category_id INT NOT NULL, name VARCHAR(150) NOT NULL, supplier VARCHAR(150) NULL,
    amount DECIMAL(10,2) NOT NULL, payment_mode VARCHAR(30) NOT NULL, notes VARCHAR(500) NULL, attachment VARCHAR(255) NULL, added_by INT NULL,
    is_deleted TINYINT NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX (expense_date))`,
  `CREATE TABLE IF NOT EXISTS bb_notifications (
    id INT AUTO_INCREMENT PRIMARY KEY, type VARCHAR(20) NOT NULL, title VARCHAR(150) NOT NULL, message VARCHAR(500) NULL, priority VARCHAR(10) NOT NULL DEFAULT 'normal',
    link_type VARCHAR(20) NULL, link_id VARCHAR(30) NULL, is_read TINYINT NOT NULL DEFAULT 0, is_archived TINYINT NOT NULL DEFAULT 0,
    dedupe_key VARCHAR(80) NULL UNIQUE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX (is_read, is_archived))`,
  `CREATE TABLE IF NOT EXISTS bb_audit (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NULL, user_name VARCHAR(100) NULL, action VARCHAR(30) NOT NULL, module VARCHAR(40) NOT NULL,
    details VARCHAR(500) NULL, record_id VARCHAR(40) NULL, old_values TEXT NULL, new_values TEXT NULL, ip VARCHAR(60) NULL, user_agent VARCHAR(255) NULL,
    level VARCHAR(10) NOT NULL DEFAULT 'info', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX (created_at), INDEX (module))`,
  `CREATE TABLE IF NOT EXISTS bb_backups (id INT AUTO_INCREMENT PRIMARY KEY, filename VARCHAR(120) NOT NULL, size INT NOT NULL DEFAULT 0,
    created_by VARCHAR(100) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
];

const ROLE_PERMS = {
  admin: PERMISSIONS.map((p) => p[0]),
  manager: PERMISSIONS.map((p) => p[0]).filter((p) => !["staff", "backup"].includes(p)),
  cashier: ["pos", "orders", "tables", "menu", "customers", "customers.manage", "reports", "discount"],
};

async function migrate() {
  for (const sql of DDL) await q(sql);

  // --- existing tables: keep data, add the new columns ---
  const cat = [["icon", "VARCHAR(20) NULL"], ["description", "VARCHAR(255) NULL"], ["display_order", "INT NOT NULL DEFAULT 0"], ["show_in_pos", "TINYINT NOT NULL DEFAULT 1"],
    ["is_active", "TINYINT NOT NULL DEFAULT 1"], ["image_url", "VARCHAR(255) NULL"], ["tax_rate_id", "INT NULL"], ["is_archived", "TINYINT NOT NULL DEFAULT 0"]];
  for (const [c, d] of cat) await addColumn("categories", c, d);
  const prod = [["image_url", "VARCHAR(255) NULL"], ["is_active", "TINYINT NOT NULL DEFAULT 1"], ["sku", "VARCHAR(50) NULL"], ["cost_price", "DECIMAL(10,2) NOT NULL DEFAULT 0"],
    ["item_type", "VARCHAR(10) NOT NULL DEFAULT 'veg'"], ["description", "VARCHAR(255) NULL"], ["show_in_pos", "TINYINT NOT NULL DEFAULT 1"], ["is_featured", "TINYINT NOT NULL DEFAULT 0"],
    ["tax_rate_id", "INT NULL"], ["track_stock", "TINYINT NOT NULL DEFAULT 0"], ["stock_qty", "INT NOT NULL DEFAULT 0"], ["low_stock_level", "INT NOT NULL DEFAULT 5"],
    ["is_archived", "TINYINT NOT NULL DEFAULT 0"]];
  for (const [c, d] of prod) await addColumn("products", c, d);
  await q("UPDATE categories SET display_order = id WHERE display_order = 0");

  // --- seed data (only when empty) ---
  for (const [name, perms] of Object.entries(ROLE_PERMS))
    await q("INSERT IGNORE INTO bb_roles (name, permissions, is_system) VALUES (?,?,1)", [name, JSON.stringify(perms)]);
  await q("UPDATE bb_roles SET permissions = ? WHERE name = 'admin'", [JSON.stringify(ROLE_PERMS.admin)]);

  const [{ n: taxCount }] = await q("SELECT COUNT(*) n FROM bb_tax_rates");
  if (!taxCount) {
    await q("INSERT INTO bb_tax_rates (name, rate, description) VALUES ?", [[
      ["GST 0%", 0, "Nil rated (no tax)"], ["GST 5%", 5, "For essential food items"], ["GST 12%", 12, "For processed food items"],
      ["GST 18%", 18, "For beverages & others"], ["GST 28%", 28, "For premium / luxury items"]]]);
  }
  const [{ n: ecount }] = await q("SELECT COUNT(*) n FROM bb_expense_categories");
  if (!ecount)
    await q("INSERT INTO bb_expense_categories (name) VALUES ?", [["Food Ingredients", "Staff Salary", "Utilities", "Rent", "Packaging", "Cleaning", "Maintenance", "Marketing", "Miscellaneous"].map((x) => [x])]);
  const [{ n: tcount }] = await q("SELECT COUNT(*) n FROM bb_tables");
  if (!tcount) await q("INSERT INTO bb_tables (name, capacity, sort_order, status_since) VALUES ?", [Array.from({ length: 24 }, (_, i) => [`T${i + 1}`, 4, i + 1, new Date()])]);

  const [{ n: scount }] = await q("SELECT COUNT(*) n FROM bb_settings");
  if (!scount) {
    const gst5 = (await q("SELECT id FROM bb_tax_rates WHERE rate = 5 ORDER BY id LIMIT 1"))[0];
    const s = { ...DEFAULTS, default_tax_rate_id: gst5 ? gst5.id : 0 };
    await q("INSERT INTO bb_settings (k, v) VALUES ?", [Object.entries(s).map(([k, v]) => [k, JSON.stringify(v)])]);
  }
  await q("INSERT IGNORE INTO bb_sequences (name, value) VALUES ('bill', ?)", [DEFAULTS.bill_start - 1]);
  // give products without a tax mapping nothing special; category/product mapping is optional (falls back to default rate)

  // first admin account comes from .env (password is stored hashed)
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (email && process.env.ADMIN_PASSWORD) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
    const ex = await q("SELECT id FROM bb_users WHERE email = ?", [email]);
    if (!ex.length) await q("INSERT INTO bb_users (name, email, password_hash, role) VALUES ('Admin', ?, ?, 'admin')", [email, hash]);
  } else {
    const [{ n }] = await q("SELECT COUNT(*) n FROM bb_users");
    if (!n) console.warn("No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD in backend-node/.env, then restart.");
  }
}

module.exports = { migrate };

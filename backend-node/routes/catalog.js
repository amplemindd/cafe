"use strict";
// Categories, Menu items (products) and Taxes / GST
const { api, q, one, tx, cq, fail, audit, notify, saveUpload, removeUpload, paging, like, str, bool, num, r2, dateRange, getSettings, clearSettingsCache, pool } = require("../lib/core");

/* ================= CATEGORIES ================= */
const CAT_SELECT = `SELECT c.id, c.name, c.icon, c.description, c.display_order, c.show_in_pos, c.is_active, c.image_url, c.tax_rate_id, c.created_at,
  (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_archived = 0) AS product_count FROM categories c`;

api.get("/api/categories", "auth", async (ctx) => {
  const where = ["c.is_archived = 0"], p = [];
  if (ctx.query.pos === "1") where.push("c.is_active = 1 AND c.show_in_pos = 1");
  if (ctx.query.q) { where.push("c.name LIKE ?"); p.push(like(ctx.query.q)); }
  if (ctx.query.status === "active") where.push("c.is_active = 1");
  if (ctx.query.status === "inactive") where.push("c.is_active = 0");
  return { categories: await q(`${CAT_SELECT} WHERE ${where.join(" AND ")} ORDER BY c.display_order, c.id`, p) };
});

async function catBody(b, existing) {
  const name = str(b.name, 100);
  if (!name) throw fail(400, "Category name is required.");
  const dup = await one("SELECT id FROM categories WHERE name = ? AND is_archived = 0 AND id <> ?", [name, existing || 0]);
  if (dup) throw fail(409, "A category with this name already exists.");
  let tax = b.tax_rate_id ? Number(b.tax_rate_id) : null;
  if (tax && !(await one("SELECT id FROM bb_tax_rates WHERE id = ?", [tax]))) tax = null;
  return { name, icon: str(b.icon, 20) || "☕", description: str(b.description, 255) || null, show_in_pos: bool(b.show_in_pos, 1), is_active: bool(b.is_active, 1), tax_rate_id: tax };
}

api.post("/api/categories", "menu.manage", async (ctx) => {
  const v = await catBody(ctx.body);
  const image = ctx.body.image_data ? saveUpload(ctx.body.image_data) : null;
  const [{ m }] = await q("SELECT COALESCE(MAX(display_order),0) + 1 AS m FROM categories");
  const r = (await pool.query("INSERT INTO categories (name, icon, description, display_order, show_in_pos, is_active, image_url, tax_rate_id) VALUES (?,?,?,?,?,?,?,?)",
    [v.name, v.icon, v.description, m, v.show_in_pos, v.is_active, image, v.tax_rate_id]))[0];
  await audit(ctx, { action: "Added", module: "Categories", details: `Added new category "${v.name}"`, record_id: r.insertId });
  return { __status: 201, id: r.insertId, message: "Category added." };
});

api.post("/api/categories/reorder", "menu.manage", async (ctx) => {
  const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids.map(Number).filter(Boolean) : [];
  await tx(async (c) => { for (let i = 0; i < ids.length; i++) await c.query("UPDATE categories SET display_order = ? WHERE id = ?", [i + 1, ids[i]]); });
  return { message: "Order saved." };
});

api.put("/api/categories/:id", "menu.manage", async (ctx) => {
  const id = Number(ctx.params.id);
  const old = await one("SELECT * FROM categories WHERE id = ? AND is_archived = 0", [id]);
  if (!old) throw fail(404, "Category not found.");
  const v = await catBody(ctx.body, id);
  let image = old.image_url;
  if (ctx.body.image_data) { image = saveUpload(ctx.body.image_data); removeUpload(old.image_url); }
  else if (ctx.body.remove_image) { removeUpload(old.image_url); image = null; }
  await q("UPDATE categories SET name=?, icon=?, description=?, show_in_pos=?, is_active=?, image_url=?, tax_rate_id=? WHERE id=?",
    [v.name, v.icon, v.description, v.show_in_pos, v.is_active, image, v.tax_rate_id, id]);
  await audit(ctx, { action: "Updated", module: "Categories", details: `Updated category "${v.name}"`, record_id: id, old: { name: old.name, is_active: old.is_active }, neu: { name: v.name, is_active: v.is_active } });
  return { message: "Category updated." };
});

api.patch("/api/categories/:id/status", "menu.manage", async (ctx) => {
  const id = Number(ctx.params.id), active = bool(ctx.body.is_active);
  const r = (await pool.query("UPDATE categories SET is_active = ? WHERE id = ? AND is_archived = 0", [active, id]))[0];
  if (!r.affectedRows) throw fail(404, "Category not found.");
  await audit(ctx, { action: "Updated", module: "Categories", details: `${active ? "Enabled" : "Disabled"} category #${id}`, record_id: id });
  return { message: active ? "Category enabled." : "Category disabled." };
});

api.delete("/api/categories/:id", "menu.manage", async (ctx) => {
  const id = Number(ctx.params.id);
  const c = await one("SELECT * FROM categories WHERE id = ? AND is_archived = 0", [id]);
  if (!c) throw fail(404, "Category not found.");
  const [{ n }] = await q("SELECT COUNT(*) n FROM products WHERE category_id = ? AND is_archived = 0", [id]);
  if (n) throw fail(400, `"${c.name}" still has ${n} menu item(s). Move or delete them first, or disable the category instead.`);
  const [{ used }] = await q("SELECT COUNT(*) used FROM products WHERE category_id = ?", [id]);
  if (used) await q("UPDATE categories SET is_archived = 1, is_active = 0 WHERE id = ?", [id]); // archived products reference it
  else { await q("DELETE FROM categories WHERE id = ?", [id]); removeUpload(c.image_url); }
  await audit(ctx, { action: "Deleted", module: "Categories", details: `Deleted category "${c.name}"`, record_id: id, level: "warning" });
  return { message: "Category deleted." };
});

/* ================= PRODUCTS ================= */
const PROD_SELECT = `SELECT p.id, p.category_id, p.name, p.mrp AS price, p.cost_price, p.image_url, p.is_active, p.show_in_pos, p.is_featured, p.item_type,
  p.sku, p.description, p.tax_rate_id, p.track_stock, p.stock_qty, p.low_stock_level, p.created_at, c.name AS category_name, c.icon AS category_icon
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

api.get("/api/products", "auth", async (ctx) => {
  const where = ["p.is_archived = 0"], p = [], Q = ctx.query;
  if (Q.pos === "1") where.push("p.is_active = 1 AND p.show_in_pos = 1 AND (c.id IS NULL OR (c.is_active = 1 AND c.show_in_pos = 1))");
  if (Q.category_id) { where.push("p.category_id = ?"); p.push(Number(Q.category_id)); }
  if (Q.type) { where.push("p.item_type = ?"); p.push(Q.type); }
  if (Q.availability === "available") where.push("p.is_active = 1");
  if (Q.availability === "unavailable") where.push("p.is_active = 0");
  if (Q.q) { where.push("(p.name LIKE ? OR p.sku LIKE ? OR c.name LIKE ?)"); p.push(like(Q.q), like(Q.q), like(Q.q)); }
  const sorts = { name: "p.name ASC", name_desc: "p.name DESC", price: "p.mrp ASC", price_desc: "p.mrp DESC", newest: "p.id DESC" };
  const { limit, offset } = paging(Q, 500, 2000);
  const w = where.join(" AND ");
  const [{ total }] = await q(`SELECT COUNT(*) total FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${w}`, p);
  const rows = await q(`${PROD_SELECT} WHERE ${w} ORDER BY ${sorts[Q.sort] || "c.display_order, p.name"} LIMIT ? OFFSET ?`, [...p, limit, offset]);
  return { products: rows, total };
});

api.get("/api/products/:id", "auth", async (ctx) => {
  const p = await one(`${PROD_SELECT} WHERE p.id = ? AND p.is_archived = 0`, [Number(ctx.params.id)]);
  if (!p) throw fail(404, "Menu item not found.");
  return { product: p };
});

async function prodBody(b, id) {
  const name = str(b.name, 150), price = num(b.price, NaN), cost = num(b.cost_price, 0);
  if (!name) throw fail(400, "Item name is required.");
  if (!Number.isFinite(price) || price < 0 || price > 1000000) throw fail(400, "Enter a valid price.");
  if (cost < 0) throw fail(400, "Cost price cannot be negative.");
  const cat = await one("SELECT id FROM categories WHERE id = ? AND is_archived = 0", [Number(b.category_id)]);
  if (!cat) throw fail(400, "Please select a valid category.");
  const type = ["veg", "nonveg", "egg"].includes(b.item_type) ? b.item_type : "veg";
  const sku = str(b.sku, 50) || null;
  if (sku && (await one("SELECT id FROM products WHERE sku = ? AND id <> ?", [sku, id || 0]))) throw fail(409, "This SKU is already used by another item.");
  let tax = b.tax_rate_id ? Number(b.tax_rate_id) : null;
  if (tax && !(await one("SELECT id FROM bb_tax_rates WHERE id = ?", [tax]))) tax = null;
  return { name, price: r2(price), cost: r2(cost), category_id: cat.id, type, sku, description: str(b.description, 255) || null,
    is_active: bool(b.is_active, 1), show_in_pos: bool(b.show_in_pos, 1), is_featured: bool(b.is_featured, 0), tax_rate_id: tax,
    track_stock: bool(b.track_stock, 0), stock_qty: Math.max(Math.floor(num(b.stock_qty, 0)), 0), low_stock_level: Math.max(Math.floor(num(b.low_stock_level, 5)), 0) };
}

api.post("/api/products", "menu.manage", async (ctx) => {
  const v = await prodBody(ctx.body);
  const image = ctx.body.image_data ? saveUpload(ctx.body.image_data) : ""; // image is optional
  const r = (await pool.query(
    `INSERT INTO products (category_id, name, mrp, cost_price, image_url, is_active, show_in_pos, is_featured, item_type, sku, description, tax_rate_id, track_stock, stock_qty, low_stock_level)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [v.category_id, v.name, v.price, v.cost, image, v.is_active, v.show_in_pos, v.is_featured, v.type, v.sku, v.description, v.tax_rate_id, v.track_stock, v.stock_qty, v.low_stock_level]))[0];
  await audit(ctx, { action: "Created", module: "Menu Items", details: `Added new item "${v.name}" (₹${v.price})`, record_id: r.insertId, neu: { name: v.name, price: v.price } });
  return { __status: 201, id: r.insertId, message: "Menu item saved." };
});

api.put("/api/products/:id", "menu.manage", async (ctx) => {
  const id = Number(ctx.params.id);
  const old = await one("SELECT * FROM products WHERE id = ? AND is_archived = 0", [id]);
  if (!old) throw fail(404, "Menu item not found.");
  const v = await prodBody(ctx.body, id);
  let image = old.image_url || "";
  if (ctx.body.image_data) { image = saveUpload(ctx.body.image_data); removeUpload(old.image_url); }
  else if (ctx.body.remove_image) { removeUpload(old.image_url); image = ""; }
  await q(`UPDATE products SET category_id=?, name=?, mrp=?, cost_price=?, image_url=?, is_active=?, show_in_pos=?, is_featured=?, item_type=?, sku=?, description=?,
    tax_rate_id=?, track_stock=?, stock_qty=?, low_stock_level=? WHERE id=?`,
    [v.category_id, v.name, v.price, v.cost, image, v.is_active, v.show_in_pos, v.is_featured, v.type, v.sku, v.description, v.tax_rate_id, v.track_stock, v.stock_qty, v.low_stock_level, id]);
  const priceChanged = Number(old.mrp) !== v.price;
  await audit(ctx, { action: "Updated", module: "Menu Items",
    details: priceChanged ? `Updated price of "${v.name}" (₹${old.mrp} → ₹${v.price})` : `Updated item "${v.name}"`, record_id: id,
    old: { name: old.name, price: old.mrp, is_active: old.is_active }, neu: { name: v.name, price: v.price, is_active: v.is_active } });
  if (priceChanged) await notify({ type: "system", title: "Menu Item Updated", message: `Price of ${v.name} updated from ₹${old.mrp} to ₹${v.price}`, link_type: "product", link_id: id });
  return { message: "Menu item updated." };
});

api.patch("/api/products/:id/status", "menu.manage", async (ctx) => {
  const id = Number(ctx.params.id), active = bool(ctx.body.is_active);
  const r = (await pool.query("UPDATE products SET is_active = ? WHERE id = ? AND is_archived = 0", [active, id]))[0];
  if (!r.affectedRows) throw fail(404, "Menu item not found.");
  await audit(ctx, { action: "Updated", module: "Menu Items", details: `${active ? "Enabled" : "Disabled"} item #${id}`, record_id: id });
  return { message: active ? "Item is now available." : "Item marked unavailable." };
});

api.post("/api/products/:id/duplicate", "menu.manage", async (ctx) => {
  const p = await one("SELECT * FROM products WHERE id = ? AND is_archived = 0", [Number(ctx.params.id)]);
  if (!p) throw fail(404, "Menu item not found.");
  const r = (await pool.query(
    `INSERT INTO products (category_id, name, mrp, cost_price, image_url, is_active, show_in_pos, is_featured, item_type, description, tax_rate_id, track_stock, stock_qty, low_stock_level)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [p.category_id, `${p.name} (Copy)`.slice(0, 150), p.mrp, p.cost_price, "", p.is_active, p.show_in_pos, p.is_featured, p.item_type, p.description, p.tax_rate_id, p.track_stock, p.stock_qty, p.low_stock_level]))[0];
  await audit(ctx, { action: "Created", module: "Menu Items", details: `Duplicated item "${p.name}"`, record_id: r.insertId });
  return { __status: 201, id: r.insertId, message: "Item duplicated. You can now edit the copy." };
});

api.delete("/api/products/:id", "menu.manage", async (ctx) => {
  const id = Number(ctx.params.id);
  const p = await one("SELECT * FROM products WHERE id = ? AND is_archived = 0", [id]);
  if (!p) throw fail(404, "Menu item not found.");
  const [{ used }] = await q("SELECT COUNT(*) used FROM bb_order_items WHERE product_id = ?", [id]);
  if (used) { await q("UPDATE products SET is_archived = 1, is_active = 0 WHERE id = ?", [id]); } // keep history intact
  else { await q("DELETE FROM products WHERE id = ?", [id]); removeUpload(p.image_url); }
  await audit(ctx, { action: "Deleted", module: "Menu Items", details: `Deleted item "${p.name}"${used ? " (archived, used in past bills)" : ""}`, record_id: id, level: "warning" });
  return { message: used ? "Item archived (it is used in past bills)." : "Menu item deleted." };
});

/* ================= TAXES / GST ================= */
api.get("/api/taxes", "taxes", async (ctx) => {
  const S = await getSettings();
  const { from, to } = dateRange({ from: ctx.query.from || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`, to: ctx.query.to || new Date().toISOString().slice(0, 10) });
  const rates = await q("SELECT id, name, rate, description, is_active FROM bb_tax_rates ORDER BY rate");
  const categories = await q("SELECT id, name, icon, tax_rate_id, is_active FROM categories WHERE is_archived = 0 ORDER BY display_order, id");
  const products = await q(`SELECT p.id, p.name, p.image_url, p.tax_rate_id, p.category_id, c.name AS category_name, c.tax_rate_id AS category_tax_rate_id
    FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.is_archived = 0 ORDER BY c.display_order, p.name`);
  const [sum] = await q("SELECT COALESCE(SUM(tax_amount),0) AS tax, COALESCE(SUM(total),0) AS sales FROM bb_orders WHERE payment_status='paid' AND DATE(paid_at) BETWEEN ? AND ?", [from, to]);
  const def = rates.find((r) => r.id === S.default_tax_rate_id);
  return { rates, categories, products, summary: { enabled: !!S.tax_enabled, mode: S.tax_mode, default_rate: def ? def.rate : 0, default_name: def ? def.name : "None", tax_collected: sum.tax, sales: sum.sales, from, to } };
});

function rateBody(b) {
  const name = str(b.name, 60), rate = num(b.rate, NaN);
  if (!name) throw fail(400, "Tax name is required.");
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw fail(400, "Tax rate must be between 0 and 100.");
  return { name, rate: r2(rate), description: str(b.description, 200) || null, is_active: bool(b.is_active, 1) };
}
api.post("/api/taxes", "taxes", async (ctx) => {
  const v = rateBody(ctx.body);
  const r = (await pool.query("INSERT INTO bb_tax_rates (name, rate, description, is_active) VALUES (?,?,?,?)", [v.name, v.rate, v.description, v.is_active]))[0];
  await audit(ctx, { action: "Created", module: "Taxes / GST", details: `Added tax rate "${v.name}" (${v.rate}%)`, record_id: r.insertId, level: "warning" });
  return { __status: 201, id: r.insertId, message: "Tax rate saved." };
});
api.put("/api/taxes/mappings/categories/:id", "taxes", async (ctx) => {
  const id = Number(ctx.params.id), tid = ctx.body.tax_rate_id ? Number(ctx.body.tax_rate_id) : null;
  if (tid && !(await one("SELECT id FROM bb_tax_rates WHERE id = ?", [tid]))) throw fail(400, "Unknown tax rate.");
  await q("UPDATE categories SET tax_rate_id = ? WHERE id = ?", [tid, id]);
  await audit(ctx, { action: "Updated", module: "Taxes / GST", details: `Changed tax mapping of category #${id}`, record_id: id, level: "critical" });
  return { message: "Category tax updated (applies to new bills only)." };
});
api.put("/api/taxes/mappings/products/:id", "taxes", async (ctx) => {
  const id = Number(ctx.params.id), tid = ctx.body.tax_rate_id ? Number(ctx.body.tax_rate_id) : null;
  if (tid && !(await one("SELECT id FROM bb_tax_rates WHERE id = ?", [tid]))) throw fail(400, "Unknown tax rate.");
  await q("UPDATE products SET tax_rate_id = ? WHERE id = ?", [tid, id]);
  await audit(ctx, { action: "Updated", module: "Taxes / GST", details: `Changed product tax override of item #${id}`, record_id: id, level: "critical" });
  return { message: "Product tax updated (applies to new bills only)." };
});
api.put("/api/taxes/:id", "taxes", async (ctx) => {
  const id = Number(ctx.params.id), v = rateBody(ctx.body);
  const old = await one("SELECT * FROM bb_tax_rates WHERE id = ?", [id]);
  if (!old) throw fail(404, "Tax rate not found.");
  await q("UPDATE bb_tax_rates SET name=?, rate=?, description=?, is_active=? WHERE id=?", [v.name, v.rate, v.description, v.is_active, id]);
  await audit(ctx, { action: "Updated", module: "Taxes / GST", details: `Changed GST rate (${old.rate}% → ${v.rate}%) for "${v.name}"`, record_id: id, old, neu: v, level: "critical" });
  return { message: "Tax rate updated. Old bills are not changed." };
});
api.delete("/api/taxes/:id", "taxes", async (ctx) => {
  const id = Number(ctx.params.id), S = await getSettings();
  const t = await one("SELECT * FROM bb_tax_rates WHERE id = ?", [id]);
  if (!t) throw fail(404, "Tax rate not found.");
  const [{ n }] = await q("SELECT (SELECT COUNT(*) FROM categories WHERE tax_rate_id = ?) + (SELECT COUNT(*) FROM products WHERE tax_rate_id = ?) AS n", [id, id]);
  if (n || S.default_tax_rate_id === id) throw fail(400, "This rate is in use (default or mapped). Disable it instead.");
  await q("DELETE FROM bb_tax_rates WHERE id = ?", [id]);
  await audit(ctx, { action: "Deleted", module: "Taxes / GST", details: `Deleted tax rate "${t.name}"`, record_id: id, level: "warning" });
  return { message: "Tax rate deleted." };
});

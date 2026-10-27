import React, { useCallback, useEffect, useState } from "react";
import { A, ShellCtx, navigate, useAuth, useFetch, usePath } from "../lib/store";
import { api, fmtTime, img, money, ago } from "../lib/api";
import { useClickAway } from "../lib/ui";

const PUBLIC = [["pos", "POS / Billing", "🛒", "/"], ["orders", "Orders", "🧾", "/orders"], ["tables", "Tables", "🪑", "/tables"], ["menu", "Menu Items", "📋", "/menu"], ["customers", "Customers", "👥", "/customers"], ["reports", "Reports", "📊", "/reports"]];
const ADMIN = [["dashboard", "Dashboard", "🏠", "/admin-dashboard", "reports"], ["pos", "POS / Billing", "🛒", "/admin/pos", "pos"], ["orders", "Orders", "🧾", "/admin/orders", "orders"], ["tables", "Tables", "🪑", "/admin/tables", "tables"],
  ["menu", "Menu Items", "📋", "/admin/menu", "menu"], ["categories", "Categories", "🗂️", "/admin/categories", "menu"], ["customers", "Customers", "👥", "/admin/customers", "customers"], ["reports", "Reports", "📊", "/admin/reports", "reports"],
  ["expenses", "Expenses", "💸", "/admin/expenses", "expenses"], ["taxes", "Taxes / GST", "🧮", "/admin/taxes", "taxes"], ["users", "Staff / Users", "🧑‍🍳", "/admin/users", "staff"], ["audit", "Audit Logs", "🕒", "/admin/audit", "audit"],
  ["notifications", "Notifications", "🔔", "/admin/notifications", "notifications"], ["settings", "Settings", "⚙️", "/admin/settings", "settings"]];
export const REPORT_LINKS = [["sales", "Sales Report"], ["orders", "Order Report"], ["items", "Item Report"], ["payments", "Payment Report"], ["taxes", "Tax Report"], ["expenses", "Expense Report"], ["profit-loss", "Profit & Loss"], ["daily", "Daily Report"], ["monthly", "Monthly Report"]];
const NOTE_ICON = { order: "🛒", payment: "💳", inventory: "📦", table: "🪑", customer: "👤", expense: "⚠️", report: "📅", system: "⚙️", staff: "👥" };
const NOTE_LINK = { order: "/admin/orders", table: "/admin/tables", product: "/admin/menu", customer: "/admin/customers", report: "/admin/reports/daily", expense: "/admin/expenses" };

export default function Shell({ admin, children }) {
  const { user, settings, can, logout, isStaff } = useAuth();
  const path = usePath();
  const [search, setSearch] = useState("");
  const [catSel, setCatSel] = useState("");
  const [collapsed, setCollapsed] = useState(settings.sidebar_style === "collapsed");
  const [drawer, setDrawer] = useState(false);
  const [bell, setBell] = useState(false);
  const [umenu, setUmenu] = useState(false);
  const [sub, setSub] = useState(path.startsWith("/admin/reports"));
  const [now, setNow] = useState(new Date());
  const [bump, setBump] = useState(0);
  const reload = useCallback(() => setBump((b) => b + 1), []);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { setSearch(""); setDrawer(false); setBell(false); }, [path]);
  useEffect(() => { if (admin && !isStaff) navigate("/admin-login"); }, [admin, isStaff]);

  const open = useFetch("/orders/open", null, [bump], 15000);
  const notes = useFetch(admin && can("notifications") ? "/notifications" : "", { limit: 5, status: "unread" }, [bump], 20000);
  const cats = useFetch(admin ? "" : "/categories", { pos: 1 }, [bump], 60000);
  const openOrders = open.data?.orders || [];
  const unread = notes.data?.unread_total || 0;
  const bellRef = useClickAway(() => setBell(false));
  const uRef = useClickAway(() => setUmenu(false));
  const nav = admin ? ADMIN.filter((n) => can(n[4])) : PUBLIC;
  const link = (p) => (admin ? (p === "dashboard" ? "/admin-dashboard" : `/admin/${p}`) : p === "pos" ? "/" : `/${p}`);
  const act = (to) => (to === "/" ? path === "/" : path === to || (to !== "/admin-dashboard" && path.startsWith(to + "/")));
  const searchPh = path.includes("order") ? "Search orders by bill no, table no, customer, phone..." : path.includes("customer") ? "Search customer by name, phone number, email..." : path.includes("menu") || path === "/" || path.includes("pos") ? "Search menu items (e.g. coffee, tea, sandwich...)" : "Search...";
  const bellGo = (n) => { setBell(false); navigate(NOTE_LINK[n.link_type] || "/admin/notifications", n.link_type === "order" ? { openId: Number(n.link_id) } : null); api(`/notifications/${n.id}/read`, { method: "PATCH" }).then(reload).catch(() => {}); };

  return (
    <ShellCtx.Provider value={{ search, setSearch, admin, link, catSel, setCatSel, bump, reload, openCount: openOrders.length }}>
      <div className={`app ${collapsed ? "col" : ""} ${drawer ? "drawer" : ""}`}>
        <header className="hdr">
          <button className="hamb" onClick={() => (window.innerWidth < 900 ? setDrawer(!drawer) : setCollapsed(!collapsed))} aria-label="Menu">☰</button>
          <A to={admin ? "/admin-dashboard" : "/"} className="brand">
            {settings.logo_url ? <img src={img(settings.logo_url)} alt="" className="blogo" /> : <span className="bcup">☕</span>}
            <span className="bname"><b>{String(settings.restaurant_name || "Brew & Bite").toUpperCase()}</b><small>CAFÉ &amp; RESTAURANT</small></span>
          </A>
          <div className="hsearch"><span>🔍</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPh} aria-label="Search" /></div>
          <div className="hright">
            <div className="bellw" ref={bellRef}>
              <button className="hbtn" onClick={() => setBell(!bell)} aria-label="Notifications">🔔{(admin ? unread : openOrders.length) > 0 && <span className="bdg">{admin ? unread : openOrders.length}</span>}</button>
              {bell && (
                <div className="dd">
                  {admin ? (<>
                    {(notes.data?.notifications || []).map((n) => <button key={n.id} className="dd-i" onClick={() => bellGo(n)}><span className="dd-ic">{NOTE_ICON[n.type] || "🔔"}</span><span><b>{n.title}</b><small>{n.message}</small><small>{ago(n.created_at)}</small></span></button>)}
                    {!(notes.data?.notifications || []).length && <p className="muted pad">You're all caught up.</p>}
                    <A to="/admin/notifications" className="dd-f">View All Notifications →</A>
                  </>) : (<>
                    <div className="dd-t">Orders on hold ({openOrders.length})</div>
                    {openOrders.map((o) => <button key={o.id} className="dd-i" onClick={() => { setBell(false); navigate("/", { orderId: o.id }); }}><span className="dd-ic">🍽️</span><span><b>{o.table_name ? `Table ${o.table_name}` : o.order_type === "pickup" ? "Pick Up" : "Delivery"} · {o.bill_no}</b><small>{ago(o.created_at)}</small></span><b>{money(o.total)}</b></button>)}
                    {!openOrders.length && <p className="muted pad">No orders on hold.</p>}
                  </>)}
                </div>
              )}
            </div>
            <div className="clock"><span>📅</span><div><b>{now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).replace(/,/g, "")}</b><small>{fmtTime(now)}</small></div></div>
            <div className="uw" ref={uRef}>
              <button className="user" onClick={() => setUmenu(!umenu)}><span className="uav">{(user?.name || "C")[0]}</span><span className="uname">{user?.name || "Cashier"}</span>▾</button>
              {umenu && (
                <div className="dd sm">
                  <div className="dd-t">{user?.name} <small>({user?.role})</small></div>
                  {isStaff ? <>
                    {!admin && <A to="/admin-dashboard" className="dd-l">🏠 Admin Dashboard</A>}
                    {admin && <A to="/" className="dd-l">🛒 Public POS</A>}
                    <button className="dd-l" onClick={async () => { await logout(); navigate(admin ? "/admin-login" : "/"); }}>⎋ Logout</button>
                  </> : <A to="/admin-login" className="dd-l">🔐 Admin / Staff Login</A>}
                </div>
              )}
            </div>
            <A to={admin ? "/admin/settings" : "/admin-login"} className="hbtn" aria-label="Settings">⚙️</A>
          </div>
        </header>

        <aside className="side">
          <nav>
            {nav.map(([k, label, ic, to]) => (k === "reports" && admin ? (
              <div key={k}>
                <button className={`nav ${act(to) ? "on" : ""}`} onClick={() => { setSub(!sub); navigate(to); }}><span>{ic}</span><em>{label}</em><i>{sub ? "▴" : "▾"}</i></button>
                {sub && !collapsed && <div className="subnav">{REPORT_LINKS.map(([n, l]) => <A key={n} to={`/admin/reports/${n}`} className={path === `/admin/reports/${n}` ? "on" : ""}>▫ {l}</A>)}</div>}
              </div>
            ) : (
              <A key={k} to={to} className={`nav ${act(to) ? "on" : ""}`}><span>{ic}</span><em>{label}</em>
                {k === "orders" && openOrders.length > 0 && <b className="nbdg">{openOrders.length}</b>}{k === "notifications" && unread > 0 && <b className="nbdg">{unread}</b>}</A>
            )))}
          </nav>
          {!admin && (
            <div className="catlist">
              <div className="cap">CATEGORIES</div>
              {(cats.data?.categories || []).map((c) => (
                <button key={c.id} className={`nav ${path === "/" && String(catSel) === String(c.id) ? "on" : ""}`} onClick={() => { setCatSel(c.id); navigate("/"); }}>
                  <span>{c.image_url ? <img src={img(c.image_url)} alt="" className="cimg" /> : c.icon || "☕"}</span><em>{c.name}</em></button>
              ))}
              <button className={`nav ${path === "/" && catSel === "all" ? "on" : ""}`} onClick={() => { setCatSel("all"); navigate("/"); }}><span>▦</span><em>All Items</em></button>
            </div>
          )}
          {admin && <button className="nav lo" onClick={async () => { await logout(); navigate("/admin-login"); }}><span>⎋</span><em>Logout</em></button>}
        </aside>
        {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
        <main className="main">{children}</main>
      </div>
    </ShellCtx.Provider>
  );
}

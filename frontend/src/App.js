import React from "react";
import { A, AuthProvider, UIProvider, useAuth, usePath } from "./lib/store";
import Shell from "./components/Shell";
import Login from "./pages/Login";
import Pos from "./pages/Pos";
import Orders from "./pages/Orders";
import Tables from "./pages/Tables";
import MenuItems from "./pages/MenuItems";
import Categories from "./pages/Categories";
import Customers from "./pages/Customers";
import Dashboard from "./pages/Dashboard";
import Reports, { ReportDetail } from "./pages/Reports";
import Expenses from "./pages/Expenses";
import Taxes from "./pages/Taxes";
import Users from "./pages/Users";
import Audit from "./pages/Audit";
import Notifications from "./pages/Notifications";
import Settings from "./pages/Settings";
import "./styles/app.css";

const PUBLIC = { "/": [Pos, "pos"], "/orders": [Orders, "orders"], "/tables": [Tables, "tables"], "/menu": [MenuItems, "menu"], "/customers": [Customers, "customers"], "/reports": [Reports, "reports"] };
const ADMIN = { "/admin-dashboard": [Dashboard, "reports"], "/admin/pos": [Pos, "pos"], "/admin/orders": [Orders, "orders"], "/admin/tables": [Tables, "tables"], "/admin/menu": [MenuItems, "menu"],
  "/admin/categories": [Categories, "menu"], "/admin/customers": [Customers, "customers"], "/admin/reports": [Reports, "reports"], "/admin/expenses": [Expenses, "expenses"], "/admin/taxes": [Taxes, "taxes"],
  "/admin/users": [Users, "staff"], "/admin/audit": [Audit, "audit"], "/admin/notifications": [Notifications, "notifications"], "/admin/settings": [Settings, "settings"] };

function Denied({ admin }) {
  return <div className="page"><div className="card"><div className="card-b empty"><div>🔒</div><p>You do not have permission to open this page.</p>{!admin && <A to="/admin-login" className="btn pri">Sign in as staff</A>}</div></div></div>;
}

function Router() {
  const path = usePath();
  const { loading, error, user, can, refresh } = useAuth();
  if (loading) return <div className="splash"><div className="spin" /><p>Loading Brew &amp; Bite…</p></div>;
  if (!user) return <div className="splash"><div>⚠</div><p>{error || "Cannot reach the server."}</p><button className="btn pri" onClick={refresh}>Retry</button></div>;
  if (path === "/admin-login") return <Login />;
  const rd = /^\/admin\/reports\/([\w-]+)$/.exec(path);
  const admin = path.startsWith("/admin");
  const entry = rd ? [ReportDetail, "reports"] : (admin ? ADMIN : PUBLIC)[path];
  if (!entry) return <Shell admin={admin}><div className="page"><div className="card"><div className="card-b empty"><div>🧭</div><p>Page not found.</p><A to={admin ? "/admin-dashboard" : "/"} className="btn pri">Go home</A></div></div></div></Shell>;
  const [Page, perm] = entry;
  return <Shell admin={admin}>{can(perm) ? <Page name={rd && rd[1]} key={path} /> : <Denied admin={admin} />}</Shell>;
}

export default function App() {
  return <UIProvider><AuthProvider><Router /></AuthProvider></UIProvider>;
}

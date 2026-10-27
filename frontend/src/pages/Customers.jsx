import React, { useEffect, useState } from "react";
import { api, fmtDate, fmtDT, money, num, saveCSV, cap } from "../lib/api";
import {
  navigate,
  useAuth,
  useDebounced,
  useFetch,
  useShell,
  useUI,
} from "../lib/store";
import {
  Avatar,
  Badge,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  Pager,
  Stat,
  Tabs,
} from "../lib/ui";

const blank = {
  name: "",
  phone: "",
  email: "",
  address: "",
  birthday: "",
  notes: "",
  status: "active",
};

function Detail({ id, onClose, onEdit, admin }) {
  const { can } = useAuth();
  const d = useFetch(`/customers/${id}`, null, [id]);
  const [tab, setTab] = useState("orders");
  const c = d.data?.customer;
  if (!c)
    return (
      <div className="side-panel">
        {d.error ? <ErrorBox msg={d.error} /> : <Loading />}
      </div>
    );
  return (
    <div className="side-panel">
      <div className="sp-h">
        <h3>{c.name}</h3>
        <button className="x" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="cprof">
        <Avatar name={c.name} size={64} />
        <div>
          <b>{c.name}</b> <Badge v={c.status} />
          <div className="muted">📞 {c.phone || "-"}</div>
          <div className="muted">✉ {c.email || "-"}</div>
          <div className="muted">📅 Member since: {fmtDate(c.created_at)}</div>
        </div>
      </div>
      {can("customers.manage") && (
        <button className="btn sm" onClick={() => onEdit(c)}>
          ✎ Edit
        </button>
      )}
      <div className="mini-stats">
        <div>
          <small>Total Orders</small>
          <b>{c.total_orders}</b>
        </div>
        <div>
          <small>Total Spent</small>
          <b>{money(c.total_spent)}</b>
        </div>
        <div>
          <small>Loyalty Points</small>
          <b>{c.loyalty_points}</b>
        </div>
        <div>
          <small>Member Type</small>
          <b>{c.member_type}</b>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ["orders", "Order History"],
          ["rewards", "Rewards"],
          ["notes", "Notes"],
        ]}
      />
      {tab === "orders" &&
        (d.data.orders.length ? (
          <table className="tbl sm">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Items</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {d.data.orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.bill_no}</td>
                  <td>{fmtDate(o.created_at)}</td>
                  <td>{o.items}</td>
                  <td>{money(o.total)}</td>
                  <td>
                    <Badge v={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty text="No orders yet." />
        ))}
      {tab === "rewards" &&
        (d.data.rewards.length ? (
          d.data.rewards.map((r, i) => (
            <div className="kv" key={i}>
              <span>
                {cap(r.type)} · {r.note}
                <small className="muted"> {fmtDT(r.created_at)}</small>
              </span>
              <b className={r.points < 0 ? "errtxt" : ""}>
                {r.points > 0 ? "+" : ""}
                {r.points}
              </b>
            </div>
          ))
        ) : (
          <Empty text="No reward activity yet. 1 point is earned per ₹100 billed." />
        ))}
      {tab === "notes" && (
        <p>
          {c.notes || <span className="muted">No notes.</span>}
          {c.address && (
            <>
              <br />
              <br />
              <b>Address:</b> {c.address}
            </>
          )}
        </p>
      )}
      {can("pos") && (
        <button
          className="btn pri block"
          onClick={() =>
            navigate(admin ? "/admin/pos" : "/", {
              customer: {
                id: c.id,
                name: c.name,
                phone: c.phone || "",
                address: c.address || "",
              },
            })
          }
        >
          🛒 Create New Order for this Customer
        </button>
      )}
    </div>
  );
}

export default function Customers() {
  const { can } = useAuth();
  const { toast } = useUI();
  const { search, admin } = useShell();
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState(null);
  const dq = useDebounced(search);
  const list = useFetch("/customers", { q: dq, status, page, limit: 10 });
  useEffect(() => setPage(1), [dq, status]);
  const s = list.data?.summary;
  const save = async () => {
    try {
      await api(form.id ? `/customers/${form.id}` : "/customers", {
        method: form.id ? "PUT" : "POST",
        body: form,
      });
      toast("Customer saved.");
      setForm(null);
      list.reload();
    } catch (e) {
      toast(e.message, "err");
    }
  };
  const exportCsv = async () => {
    try {
      const r = await api("/customers", {
        params: { q: dq, status, limit: 500 },
      });
      saveCSV("customers.csv", r.customers, [
        { label: "Name", key: "name" },
        { label: "Phone", key: "phone" },
        { label: "Email", key: "email" },
        { label: "Total Orders", key: "total_orders" },
        { label: "Total Spent", key: "total_spent" },
        { label: "Loyalty Points", key: "loyalty_points" },
        { label: "Status", key: "status" },
      ]);
    } catch (e) {
      toast(e.message, "err");
    }
  };
  const up = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className={`page split ${sel ? "has-panel" : ""}`}>
      <div className="split-main">
        <div className="ph">
          <div>
            <h1>Customers</h1>
            <p className="muted">
              Manage customer details, order history and loyalty information
            </p>
          </div>
          {can("customers.manage") && (
            <button className="btn pri" onClick={() => setForm({ ...blank })}>
              ＋ Add Customer
            </button>
          )}
        </div>
        <div className="kpis">
          <Stat
            icon="👥"
            label="Total Customers"
            value={num(s?.customers)}
            tone="amber"
          />
          <Stat icon="🙋" label="New This Month" value={num(s?.new_month)} />
          <Stat
            icon="🛒"
            label="Total Orders"
            value={num(s?.orders)}
            tone="blue"
          />
          <Stat
            icon="💰"
            label="Total Sales"
            value={money(s?.sales)}
            tone="purple"
          />
        </div>
        <div className="filters">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All Customers</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <span className="sp" />
          <button className="btn" onClick={exportCsv}>
            ⭳ Export
          </button>
        </div>
        <section className="card">
          <div className="table-wrap">
            {list.error && !list.data ? (
              <ErrorBox msg={list.error} retry={list.reloadFull} />
            ) : !list.data ? (
              <Loading />
            ) : !list.data.customers.length ? (
              <Empty icon="👥" text="No customers found." />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Customer Name</th>
                    <th>Phone Number</th>
                    <th>Email</th>
                    <th>Total Orders</th>
                    <th>Total Spent</th>
                    <th>Last Visit</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.customers.map((c, i) => (
                    <tr
                      key={c.id}
                      className={sel === c.id ? "sel" : ""}
                      onClick={() => setSel(c.id)}
                    >
                      <td>{(page - 1) * 10 + i + 1}</td>
                      <td>
                        <Avatar name={c.name} size={28} /> <b>{c.name}</b>
                      </td>
                      <td>{c.phone || "-"}</td>
                      <td>{c.email || "-"}</td>
                      <td>{c.total_orders}</td>
                      <td>{money(c.total_spent)}</td>
                      <td>{c.last_visit ? fmtDate(c.last_visit) : "-"}</td>
                      <td>
                        <Badge v={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {list.data && (
            <Pager
              page={page}
              total={list.data.total}
              limit={10}
              onPage={setPage}
              label="customers"
            />
          )}
        </section>
      </div>
      {sel && (
        <Detail
          id={sel}
          admin={admin}
          onClose={() => setSel(null)}
          onEdit={(c) =>
            setForm({
              ...blank,
              ...c,
              birthday: c.birthday ? String(c.birthday).slice(0, 10) : "",
              email: c.email || "",
              phone: c.phone || "",
              address: c.address || "",
              notes: c.notes || "",
            })
          }
        />
      )}
      {form && (
        <Modal
          title={form.id ? "Edit Customer" : "Add Customer"}
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="btn pri" onClick={save}>
                Save Customer
              </button>
            </>
          }
        >
          <Field label="Name" req>
            <input value={form.name} maxLength={100} onChange={up("name")} />
          </Field>
          <div className="two">
            <Field label="Phone">
              <input
                value={form.phone}
                inputMode="tel"
                maxLength={20}
                onChange={up("phone")}
                placeholder="9876543210"
              />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={up("email")} />
            </Field>
          </div>
          <Field label="Address">
            <input
              value={form.address}
              maxLength={255}
              onChange={up("address")}
            />
          </Field>
          <div className="two">
            <Field label="Birthday">
              <input
                type="date"
                value={form.birthday}
                onChange={up("birthday")}
              />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={up("status")}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              rows={2}
              maxLength={500}
              value={form.notes}
              onChange={up("notes")}
            />
          </Field>
        </Modal>
      )}
    </div>
  );
}

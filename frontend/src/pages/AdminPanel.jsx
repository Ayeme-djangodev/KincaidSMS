import { useEffect, useState } from "react";
import api, { extractErrorMessage } from "../api";
import { formatNaira } from "../utils/currency";

const TABS = ["Users", "Deposits", "Activity"];

export default function AdminPanel() {
  const [tab, setTab] = useState("Users");
  const [users, setUsers] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [adjustingUserId, setAdjustingUserId] = useState(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustDesc, setAdjustDesc] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);

  const [depositStatusFilter, setDepositStatusFilter] = useState("");
  const [retryBusy, setRetryBusy] = useState(null);

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/admin/users");
      setUsers(res.data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadDeposits() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/admin/deposits", {
        params: depositStatusFilter ? { status: depositStatusFilter } : {},
      });
      setDeposits(res.data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadActivity() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/admin/activity");
      setActivity(res.data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "Users") loadUsers();
    else if (tab === "Deposits") loadDeposits();
    else if (tab === "Activity") loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, depositStatusFilter]);

  async function handleAdjustSubmit(e, userId) {
    e.preventDefault();
    setAdjustBusy(true);
    setError("");
    try {
      const amount = parseFloat(adjustAmount);
      if (!amount) throw new Error("Enter a non-zero amount");
      await api.post(`/admin/users/${userId}/adjust-balance`, {
        amount_naira: amount,
        description: adjustDesc || "Manual adjustment",
      });
      setAdjustingUserId(null);
      setAdjustAmount("");
      setAdjustDesc("");
      await loadUsers();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setAdjustBusy(false);
    }
  }

  async function handleRetryVerify(intentId) {
    setRetryBusy(intentId);
    setError("");
    try {
      await api.post(`/admin/deposits/${intentId}/retry-verify`);
      await loadDeposits();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setRetryBusy(null);
    }
  }

  return (
    <div className="container">
      <h2>Admin</h2>

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "btn" : "btn secondary"} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {error && <div className="error-text">{error}</div>}
      {loading && <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Loading...</div>}

      {tab === "Users" && (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Balance</th>
                  <th>Admin</th>
                  <th>Joined</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{formatNaira(u.balance_naira)}</td>
                    <td>{u.is_admin ? "Yes" : ""}</td>
                    <td>{new Date(u.created_at).toLocaleDateString()}</td>
                    <td>
                      {adjustingUserId === u.id ? (
                        <form
                          onSubmit={(e) => handleAdjustSubmit(e, u.id)}
                          style={{ display: "flex", gap: 6, alignItems: "center" }}
                        >
                          <input
                            type="number"
                            step="0.01"
                            placeholder="± amount"
                            value={adjustAmount}
                            onChange={(e) => setAdjustAmount(e.target.value)}
                            style={{ width: 100 }}
                            autoFocus
                          />
                          <input
                            type="text"
                            placeholder="reason"
                            value={adjustDesc}
                            onChange={(e) => setAdjustDesc(e.target.value)}
                            style={{ width: 140 }}
                          />
                          <button className="btn" disabled={adjustBusy}>
                            {adjustBusy ? "..." : "Apply"}
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => {
                              setAdjustingUserId(null);
                              setAdjustAmount("");
                              setAdjustDesc("");
                            }}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <button className="btn secondary" onClick={() => setAdjustingUserId(u.id)}>
                          Adjust balance
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--text-dim)" }}>
                      No users yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "Deposits" && (
        <div className="card">
          <div className="form-group" style={{ maxWidth: 220 }}>
            <label>Filter by status</label>
            <select
              value={depositStatusFilter}
              onChange={(e) => setDepositStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Reference</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((d) => (
                  <tr key={d.id}>
                    <td>{d.user_email}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{d.reference}</td>
                    <td>{formatNaira(d.amount_naira)}</td>
                    <td>
                      <span className={`badge ${d.status}`}>{d.status}</span>
                    </td>
                    <td>{new Date(d.created_at).toLocaleString()}</td>
                    <td>
                      {d.status === "pending" && (
                        <button
                          className="btn secondary"
                          disabled={retryBusy === d.id}
                          onClick={() => handleRetryVerify(d.id)}
                        >
                          {retryBusy === d.id ? "Checking..." : "Retry verify"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {deposits.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} style={{ color: "var(--text-dim)" }}>
                      No deposits found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "Activity" && (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Provider</th>
                  <th>Service</th>
                  <th>Number</th>
                  <th>Status</th>
                  <th>Cost</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a, idx) => (
                  <tr key={`${a.provider}-${idx}`}>
                    <td>{a.user_email}</td>
                    <td>{a.label}</td>
                    <td>{a.service}</td>
                    <td>{a.number}</td>
                    <td>
                      <span className={`badge ${a.status}`}>{a.status}</span>
                    </td>
                    <td>{formatNaira(a.charged_naira)}</td>
                    <td>{new Date(a.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {activity.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} style={{ color: "var(--text-dim)" }}>
                      No activity yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

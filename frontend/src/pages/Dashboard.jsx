import { useCallback, useEffect, useRef, useState } from "react";
import api, { extractErrorMessage } from "../api";
import { formatNaira } from "../utils/currency";
import useIsMobile from "../hooks/useIsMobile.js";
import Buy from "./Buy.jsx";
import CopyButton from "../components/CopyButton.jsx";

const POLL_INTERVAL_MS = 5000;

// Maps each provider to its router's base path. Kept in one place so
// polling/cancel logic below can stay generic instead of three separate
// copies of the same code -- all three routers (rentals/verifications/
// activations) share the same {id}/poll and {id}/cancel shape by design.
const PROVIDERS = [
  { key: "getatext", label: "Service 1", listPath: "/rentals" },
  { key: "textverified", label: "Service 2", listPath: "/verifications" },
  { key: "bloomsms", label: "Service 3", listPath: "/activations" },
];

export default function Dashboard({ user, refreshUser }) {
  const isMobile = useIsMobile();
  const [items, setItems] = useState([]); // combined across all 3 providers
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState(null); // `${provider}:${id}` currently being cancelled
  const intervalRef = useRef(null);

  const loadAll = useCallback(async () => {
    try {
      const results = await Promise.all(
        PROVIDERS.map((p) =>
          api
            .get(p.listPath)
            .then((res) => res.data.map((row) => ({ ...row, _provider: p.key, _label: p.label, _basePath: p.listPath })))
            .catch(() => [])
        )
      );
      setItems(results.flat());
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      const current = items.filter((it) => it.status === "active");
      if (current.length === 0) return;
      try {
        const results = await Promise.all(
          current.map((it) =>
            api
              .get(`${it._basePath}/${it.id}/poll`)
              .then((res) => ({ ...res.data, _provider: it._provider, _label: it._label, _basePath: it._basePath }))
              .catch(() => it)
          )
        );
        setItems((prev) => {
          const byKey = Object.fromEntries(results.map((r) => [`${r._provider}:${r.id}`, r]));
          return prev.map((it) => byKey[`${it._provider}:${it.id}`] || it);
        });
      } catch {
        // non-fatal, skip this poll cycle
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  async function handleCancel(item) {
    const key = `${item._provider}:${item.id}`;
    setBusyKey(key);
    setError("");
    try {
      const res = await api.post(`${item._basePath}/${item.id}/cancel`);
      setItems((prev) =>
        prev.map((it) =>
          it._provider === item._provider && it.id === item.id
            ? { ...res.data, _provider: item._provider, _label: item._label, _basePath: item._basePath }
            : it
        )
      );
      await refreshUser();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  const active = items.filter((it) => it.status === "active");
  const recent = [...items]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10);

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "?";

  const activeSection = (
    <div className="card">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Active numbers</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 13, margin: "4px 0 14px" }}>
        {active.length} active. Codes appear automatically, no need to refresh.
      </p>

      {active.length === 0 ? (
        <div className="empty-state">No active numbers right now.</div>
      ) : (
        <ul className="row-list">
          {active.map((it) => {
            const key = `${it._provider}:${it.id}`;
            return (
              <li key={key} className="row-card">
                <div className="row-card-top">
                  <div>
                    <div className="row-title">{it.service_display_name || it.service_api_name}</div>
                    <div className="row-sub">{it._label}</div>
                  </div>
                  <span className="row-amount">{formatNaira(it.charged_naira)}</span>
                </div>
                <div className="row-meta">
                  <span className="row-number">{it.number}</span>
                  {it.number && <CopyButton text={it.number} label="Copy number" />}
                </div>
                {it.code ? (
                  <div className="row-code">
                    <span className="code-pill">{it.code}</span>
                    <CopyButton text={it.code} label="Copy code" />
                  </div>
                ) : (
                  <div className="row-waiting">Waiting for code...</div>
                )}
                <div className="row-actions">
                  <button
                    className="btn danger"
                    disabled={busyKey === key}
                    onClick={() => handleCancel(it)}
                  >
                    {busyKey === key ? "Cancelling..." : "Cancel and refund"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const recentSection = (
    <div className="card">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Latest 10 numbers</h2>

      {recent.length === 0 ? (
        <div className="empty-state">No rentals yet.</div>
      ) : isMobile ? (
        <ul className="row-list">
          {recent.map((it) => (
            <li key={`${it._provider}:${it.id}`} className="row-card">
              <div className="row-card-top">
                <div>
                  <div className="row-title">{it.service_display_name || it.service_api_name}</div>
                  <div className="row-sub">{it._label}</div>
                </div>
                <span className={`badge ${it.status}`}>{it.status}</span>
              </div>
              <div className="row-meta">
                <span className="row-number">{it.number}</span>
                <span>{formatNaira(it.charged_naira)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Number</th>
                <th>Status</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((it) => (
                <tr key={`${it._provider}:${it.id}`}>
                  <td>
                    {it._label} — {it.service_display_name || it.service_api_name}
                  </td>
                  <td>{it.number}</td>
                  <td>
                    <span className={`badge ${it.status}`}>{it.status}</span>
                  </td>
                  <td>{formatNaira(it.charged_naira)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // Phones: the bottom "Buy" tab already leads to the buy page, so the
  // Active tab just shows active numbers and recent history.
  if (isMobile) {
    return (
      <div className="container">
        <h1 className="page-title">Active</h1>
        {error && <div className="error-text" role="alert">{error}</div>}
        {activeSection}
        {recentSection}
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Dashboard</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>{user?.email}</span>
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "var(--signal)",
              color: "var(--signal-ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {initials}
          </span>
        </div>
      </div>

      {error && <div className="error-text" role="alert">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <div>
          {/* One buy flow for every provider; see pages/Buy.jsx. */}
          <Buy refreshUser={refreshUser} embedded onRented={loadAll} />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {activeSection}
          {recentSection}
        </div>
      </div>
    </div>
  );
}

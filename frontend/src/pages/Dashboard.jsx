import { useCallback, useEffect, useRef, useState } from "react";
import api, { extractErrorMessage } from "../api";
import { formatNaira } from "../utils/currency";
import useIsMobile from "../hooks/useIsMobile.js";
import Services from "./Services.jsx";
import TextVerifiedServices from "./TextVerifiedServices.jsx";
import BloomSMSServices from "./BloomSMSServices.jsx";

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

const TABS = [
  { key: "getatext", label: "Service 1" },
  { key: "textverified", label: "Service 2" },
  { key: "bloomsms", label: "Service 3" },
];

export default function Dashboard({ user, refreshUser }) {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState("getatext");
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

  return (
    <div style={{ padding: isMobile ? 12 : 20 }}>
      {!isMobile && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0 }}>Dashboard</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--text-dim)", fontSize: 13 }}>{user?.email}</span>
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "var(--signal)",
                color: "#1a0a03",
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
      )}

      {error && <div className="error-text">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
        <div className="card" style={{ gridColumn: "1 / 2" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                className={activeTab === t.key ? "btn" : "btn secondary"}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {/*
            Reusing the existing full page components as tab panels rather
            than duplicating their fetch/rent/search logic a second time.
            Each one still renders its own heading/spacing since they were
            built as standalone pages -- functionally correct, just not
            pixel-tight nesting. Worth revisiting if you want this tighter
            visually.
          */}
          {activeTab === "getatext" && <Services refreshUser={refreshUser} />}
          {activeTab === "textverified" && <TextVerifiedServices refreshUser={refreshUser} />}
          {activeTab === "bloomsms" && <BloomSMSServices refreshUser={refreshUser} />}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Active Numbers</h3>
            <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: -8 }}>
              {active.length} active — no need to refresh, codes appear automatically.
            </p>
            <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Number</th>
                  <th>Code</th>
                  <th>Cost</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {active.map((it) => (
                  <tr key={`${it._provider}:${it.id}`}>
                    <td>
                      {it._label} — {it.service_display_name || it.service_api_name}
                    </td>
                    <td>{it.number}</td>
                    <td>
                      {it.code ? (
                        <span className="code-pill">{it.code}</span>
                      ) : (
                        <span style={{ color: "var(--text-dim)" }}>waiting...</span>
                      )}
                    </td>
                    <td>{formatNaira(it.charged_naira)}</td>
                    <td>
                      <button
                        className="btn danger"
                        disabled={busyKey === `${it._provider}:${it.id}`}
                        onClick={() => handleCancel(it)}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
                {active.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--text-dim)" }}>
                      No active numbers right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Latest 10 Numbers</h3>
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
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--text-dim)" }}>
                      No rentals yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import api, { extractErrorMessage } from "../api";
import { formatNaira } from "../utils/currency";
import useIsMobile from "../hooks/useIsMobile.js";
import CopyButton from "../components/CopyButton.jsx";

const POLL_INTERVAL_MS = 5000;

// Same provider map used on the Dashboard -- all three routers share the
// same {id}/poll, {id}/cancel shape by design. Only getatext and bloomsms
// support a "complete" action; Fetch SMS's /verifications endpoint only
// has cancel (see verifications.py).
const PROVIDERS = [
  { key: "getatext", label: "Service 1", listPath: "/rentals", canComplete: true },
  { key: "fetchsms", label: "Service 2", listPath: "/verifications", canComplete: false },
  { key: "bloomsms", label: "Service 3", listPath: "/activations", canComplete: true },
];

export default function Rentals({ refreshUser }) {
  const isMobile = useIsMobile();
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState(null); // `${provider}:${id}` currently being acted on
  const intervalRef = useRef(null);

  const loadAll = useCallback(async () => {
    try {
      const results = await Promise.all(
        PROVIDERS.map((p) =>
          api
            .get(p.listPath)
            .then((res) =>
              res.data.map((row) => ({
                ...row,
                _provider: p.key,
                _label: p.label,
                _basePath: p.listPath,
                _canComplete: p.canComplete,
              }))
            )
            .catch(() => [])
        )
      );
      setItems(results.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function pollActive(list) {
    const active = list.filter((it) => it.status === "active");
    if (active.length === 0) return;
    try {
      const results = await Promise.all(
        active.map((it) =>
          api
            .get(`${it._basePath}/${it.id}/poll`)
            .then((res) => ({
              ...res.data,
              _provider: it._provider,
              _label: it._label,
              _basePath: it._basePath,
              _canComplete: it._canComplete,
            }))
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
  }

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setItems((current) => {
        pollActive(current);
        return current;
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, []);

  async function handleAction(item, action) {
    const key = `${item._provider}:${item.id}`;
    setBusyKey(key);
    setError("");
    try {
      const res = await api.post(`${item._basePath}/${item.id}/${action}`);
      setItems((prev) =>
        prev.map((it) =>
          it._provider === item._provider && it.id === item.id
            ? { ...res.data, _provider: item._provider, _label: item._label, _basePath: item._basePath, _canComplete: item._canComplete }
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

  const emptyText = 'No rentals yet. Head to "Buy a number" to rent one.';

  return (
    <div className="container">
      <h1 className="page-title">Rent History</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: -8 }}>
        All your numbers in one place. Active rentals are checked for a new code
        automatically every few seconds.
      </p>

      {error && <div className="error-text" role="alert">{error}</div>}

      <div className="card">
        {items.length === 0 ? (
          <div className="empty-state">{emptyText}</div>
        ) : isMobile ? (
          <ul className="row-list">
            {items.map((it) => {
              const key = `${it._provider}:${it.id}`;
              return (
                <li key={key} className="row-card">
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

                  {it.code ? (
                    <div className="row-code">
                      <span className="code-pill">{it.code}</span>
                      <CopyButton text={it.code} label="Copy code" />
                    </div>
                  ) : it.status === "active" ? (
                    <div className="row-waiting">Waiting for code...</div>
                  ) : null}

                  {it.status === "active" && (
                    <div className="row-actions">
                      {it._canComplete && (
                        <button
                          className="btn secondary"
                          disabled={busyKey === key}
                          onClick={() => handleAction(it, "complete")}
                        >
                          Mark done
                        </button>
                      )}
                      <button
                        className="btn danger"
                        disabled={busyKey === key}
                        onClick={() => handleAction(it, "cancel")}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Number</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Paid</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const key = `${it._provider}:${it.id}`;
                  return (
                    <tr key={key}>
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
                      <td>
                        <span className={`badge ${it.status}`}>{it.status}</span>
                      </td>
                      <td>{formatNaira(it.charged_naira)}</td>
                      <td>
                        {it.status === "active" && (
                          <div style={{ display: "flex", gap: 8 }}>
                            {it._canComplete && (
                              <button
                                className="btn secondary"
                                disabled={busyKey === key}
                                onClick={() => handleAction(it, "complete")}
                              >
                                Mark done
                              </button>
                            )}
                            <button
                              className="btn danger"
                              disabled={busyKey === key}
                              onClick={() => handleAction(it, "cancel")}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

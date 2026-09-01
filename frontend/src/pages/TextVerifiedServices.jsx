import { useEffect, useState } from "react";
import api, { extractErrorMessage } from "../api";
import { formatNaira } from "../utils/currency";

const DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 2;

export default function TextVerifiedServices({ refreshUser }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rentingService, setRentingService] = useState(null);
  const [lastRented, setLastRented] = useState(null); // { number, service }

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    const timeout = setTimeout(async () => {
      try {
        const res = await api.get("/services/textverified/search", {
          params: { q: trimmed, limit: 8 },
        });
        setResults(res.data);
      } catch (err) {
        setError(extractErrorMessage(err));
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [query]);

  async function handleRent(service) {
    setRentingService(service.api_name);
    setError("");
    setLastRented(null);
    try {
      const res = await api.post("/verifications/rent", { service: service.api_name });
      await refreshUser();
      setLastRented({ number: res.data.number, service: service.display_name });
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setRentingService(null);
    }
  }

  return (
    <div className="container">
      <h2>Service 2</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
        Search for a service to see live pricing. Type at least{" "}
        {MIN_QUERY_LENGTH} characters and give it a second.
      </p>

      <div className="form-group" style={{ maxWidth: 320 }}>
        <input
          placeholder="Search services..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {error && <div className="error-text">{error}</div>}

      {lastRented && (
        <div className="card" style={{ borderColor: "var(--success)" }}>
          Rented <strong>{lastRented.service}</strong> — number:{" "}
          <span className="code-pill">{lastRented.number}</span>
          <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
            A dedicated verifications history page isn't built yet — for now,
            hold onto this number.
          </div>
        </div>
      )}

      <div className="card">
        {query.trim().length < MIN_QUERY_LENGTH ? (
          <div style={{ color: "var(--text-dim)" }}>
            Start typing to search TextVerified's service catalog.
          </div>
        ) : loading ? (
          <div>Searching...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Price</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.map((s) => (
                <tr key={s.api_name}>
                  <td>{s.display_name}</td>
                  <td>{formatNaira(s.customer_price_naira)}</td>
                  <td>
                    <button
                      className="btn"
                      disabled={rentingService === s.api_name}
                      onClick={() => handleRent(s)}
                    >
                      {rentingService === s.api_name ? "Renting..." : "Rent"}
                    </button>
                  </td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ color: "var(--text-dim)" }}>
                    No matching services found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

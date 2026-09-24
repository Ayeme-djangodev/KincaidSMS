import { useEffect, useState } from "react";
import api, { extractErrorMessage } from "../api";
import { formatNaira } from "../utils/currency";

// FETCH SMS INTEGRATION (previously TextVerified -- swapped 2026-09).
// Fetch on mount, filter/slice client-side -- same pattern as
// Services.jsx. No network call happens while typing.

export default function TextVerifiedServices({ refreshUser }) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [rentingService, setRentingService] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/services/fetchsms");
      setServices(res.data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleRent(service) {
    setRentingService(service.api_name);
    setError("");
    try {
      const res = await api.post("/verifications/rent", { service: service.api_name });
      await refreshUser();
      setRentingService(null);
      setError("");
      window.alert(`Rented ${service.display_name} — number: ${res.data.number}`);
    } catch (err) {
      setError(extractErrorMessage(err));
      setRentingService(null);
    }
  }

  const DEFAULT_VISIBLE_COUNT = 5;

  // Same default-short-list behavior as Services.jsx: until the user
  // searches, show only the top N by stock instead of the whole catalog.
  const filtered = search.trim()
    ? services.filter((s) =>
        s.display_name.toLowerCase().includes(search.toLowerCase())
      )
    : [...services].sort((a, b) => b.stock - a.stock).slice(0, DEFAULT_VISIBLE_COUNT);

  return (
    <div className="container">
      <h2>Service 2</h2>

      <div className="form-group" style={{ maxWidth: 320 }}>
        <input
          placeholder="Search services..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!search.trim() && (
        <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: -8, marginBottom: 16 }}>
          Showing popular services — search to find a specific one.
        </p>
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        {loading ? (
          <div>Loading services...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Price</th>
                <th>Stock</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.api_name}>
                  <td>{s.display_name}</td>
                  <td>{formatNaira(s.customer_price_naira)}</td>
                  <td>{s.stock > 0 ? s.stock : "Out of stock"}</td>
                  <td>
                    <button
                      className="btn"
                      disabled={s.stock <= 0 || rentingService === s.api_name}
                      onClick={() => handleRent(s)}
                    >
                      {rentingService === s.api_name ? "Renting..." : "Rent"}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ color: "var(--text-dim)" }}>
                    {search.trim() ? "No services found." : "No services available."}
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

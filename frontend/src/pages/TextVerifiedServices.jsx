import { useEffect, useState } from "react";
import api, { extractErrorMessage } from "../api";
import { formatNaira } from "../utils/currency";

// FETCH SMS INTEGRATION (previously TextVerified -- swapped 2026-09).
// This used to be search-driven (debounced, one network call per query)
// because TextVerified's own API didn't return price in bulk. Fetch SMS's
// GET /services/fetchsms DOES return the full catalog with price in one
// call -- same as Services.jsx's Getatext pattern -- so this is now a
// single fetch-on-mount plus client-side filtering, identical in shape
// to Services.jsx. No network call happens while typing, so there's
// nothing here that can 404/error mid-keystroke the way the old
// search endpoint did.

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
      // Keep the simple success indicator the old page had, without a
      // dedicated verifications history page yet.
      window.alert(`Rented ${service.display_name} — number: ${res.data.number}`);
    } catch (err) {
      setError(extractErrorMessage(err));
      setRentingService(null);
    }
  }

  const filtered = services.filter((s) =>
    s.display_name.toLowerCase().includes(search.toLowerCase())
  );

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
                    No services found.
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

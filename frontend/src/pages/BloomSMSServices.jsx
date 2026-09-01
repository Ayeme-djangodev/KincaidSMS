import { useEffect, useState } from "react";
import api, { extractErrorMessage } from "../api";
import { formatNaira } from "../utils/currency";

export default function BloomSMSServices({ refreshUser }) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [rentingService, setRentingService] = useState(null);
  const [lastRented, setLastRented] = useState(null); // { number, service }

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/services/bloomsms");
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
    setLastRented(null);
    try {
      const res = await api.post("/activations/rent", { service: service.api_name });
      await refreshUser();
      setLastRented({ number: res.data.number, service: service.display_name });
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setRentingService(null);
    }
  }

  const filtered = services.filter((s) =>
    s.display_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="container">
      <h2>Service 3</h2>

      <div className="form-group" style={{ maxWidth: 320 }}>
        <input
          placeholder="Search services..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="error-text">{error}</div>}

      {lastRented && (
        <div className="card" style={{ borderColor: "var(--success)" }}>
          Rented <strong>{lastRented.service}</strong> — number:{" "}
          <span className="code-pill">{lastRented.number}</span>
          <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
            A dedicated activations history page isn't built yet — for now,
            hold onto this number.
          </div>
        </div>
      )}

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

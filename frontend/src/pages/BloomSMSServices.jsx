import { useEffect, useState } from "react";
import api, { extractErrorMessage } from "../api";
import { formatNaira } from "../utils/currency";

export default function BloomSMSServices({ refreshUser }) {
  const [services, setServices] = useState([]);
  const [countries, setCountries] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingCountries, setLoadingCountries] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [rentingService, setRentingService] = useState(null);
  const [lastRented, setLastRented] = useState(null); // { number, service, activationId }
  const [smsCode, setSmsCode] = useState(null); // { code, full_text } once it arrives
  const [waitingForCode, setWaitingForCode] = useState(false);

  useEffect(() => {
    loadCountries();
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCountry]);

  // Poll our own backend (not BloomSMS directly) for the SMS code, every
  // 3s, up to 3 minutes. Stops as soon as a code shows up or on unmount.
  useEffect(() => {
    if (!lastRented?.activationId) return;

    setSmsCode(null);
    setWaitingForCode(true);

    let cancelled = false;
    const startedAt = Date.now();
    const TIMEOUT_MS = 3 * 60 * 1000;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await api.get(`/activations/${lastRented.activationId}/code`);
        if (cancelled) return;
        if (res.data.code) {
          setSmsCode({ code: res.data.code, full_text: res.data.full_text });
          setWaitingForCode(false);
          return;
        }
      } catch (err) {
        // Swallow poll errors -- a transient failure shouldn't kill the loop.
      }
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        setWaitingForCode(false);
        return;
      }
      setTimeout(poll, 3000);
    }

    poll();

    return () => {
      cancelled = true;
    };
  }, [lastRented?.activationId]);

  async function loadCountries() {
    setLoadingCountries(true);
    try {
      const res = await api.get("/services/bloomsms/countries");
      setCountries(res.data);
      if (res.data.length > 0 && !selectedCountry) {
        setSelectedCountry(res.data[0].code);
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoadingCountries(false);
    }
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/services/bloomsms", {
        params: selectedCountry ? { country: selectedCountry } : {},
      });
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
      const res = await api.post("/activations/rent", {
        service: service.api_name,
        country: selectedCountry,
      });
      await refreshUser();
      // ASSUMPTION FLAGGED: guessing your /activations/rent response
      // includes the activation id as `activation_id` (falling back to
      // `id`). Adjust this line if your backend names it differently --
      // it has to match whatever key the sms.received webhook uses.
      setLastRented({
        number: res.data.number,
        service: service.display_name,
        activationId: res.data.activation_id || res.data.id,
      });
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

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div className="form-group" style={{ maxWidth: 320, flex: 1 }}>
          <input
            placeholder="Search services..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="form-group" style={{ maxWidth: 220 }}>
          <select
            value={selectedCountry}
            onChange={(e) => setSelectedCountry(e.target.value)}
            disabled={loadingCountries || countries.length === 0}
          >
            {loadingCountries && <option value="">Loading countries...</option>}
            {!loadingCountries && countries.length === 0 && (
              <option value="">No countries available</option>
            )}
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}

      {lastRented && (
        <div className="card" style={{ borderColor: "var(--success)" }}>
          Rented <strong>{lastRented.service}</strong> — number:{" "}
          <span className="code-pill">{lastRented.number}</span>

          {smsCode ? (
            <div style={{ marginTop: 8 }}>
              Code: <span className="code-pill">{smsCode.code}</span>
              {smsCode.full_text && (
                <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
                  {smsCode.full_text}
                </div>
              )}
            </div>
          ) : waitingForCode ? (
            <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
              Waiting for SMS code...
            </div>
          ) : (
            <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
              No code received yet — a dedicated activations history page
              isn't built yet, so hold onto this number.
            </div>
          )}
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

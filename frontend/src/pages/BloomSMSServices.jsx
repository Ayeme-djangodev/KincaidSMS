import { useEffect, useState } from "react";
import api, { extractErrorMessage } from "../api";
import { formatNaira } from "../utils/currency";

// If the API base URL is wrong on deployment, the server often returns the
// SPA's index.html (a string) with HTTP 200. Calling .map/.filter on that
// throws during render and React unmounts everything -> blank page.
// Always coerce API payloads to arrays before putting them in state.
const asArray = (v) => (Array.isArray(v) ? v : []);

const DEFAULT_COUNTRY = "187"; // United States, BloomSMS's own default

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
  const [smsCode, setSmsCode] = useState(null); // { code, full_text }
  const [waitingForCode, setWaitingForCode] = useState(false);

  // Load countries once.
  useEffect(() => {
    let ignore = false;

    async function loadCountries() {
      setLoadingCountries(true);
      try {
        const res = await api.get("/services/bloomsms/countries");
        if (ignore) return;
        const list = asArray(res.data)
          .map((c) => ({ code: String(c.code ?? c.id ?? ""), name: c.name || "" }))
          .filter((c) => c.code !== "");
        setCountries(list);
        if (list.length > 0) {
          // Prefer the US (BloomSMS's default) over whatever happens to be first.
          const preferred = list.find((c) => c.code === DEFAULT_COUNTRY) || list[0];
          setSelectedCountry(preferred.code);
        }
      } catch (err) {
        if (!ignore) setError(extractErrorMessage(err));
      } finally {
        if (!ignore) setLoadingCountries(false);
      }
    }

    loadCountries();
    return () => {
      ignore = true;
    };
  }, []);

  // Load services once countries have resolved, and whenever the country
  // changes. The `ignore` flag stops a slow earlier response from
  // overwriting a newer one.
  useEffect(() => {
    if (loadingCountries) return;
    let ignore = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await api.get("/services/bloomsms", {
          params: selectedCountry ? { country: selectedCountry } : {},
        });
        if (!ignore) setServices(asArray(res.data));
      } catch (err) {
        if (!ignore) {
          setServices([]);
          setError(extractErrorMessage(err));
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [selectedCountry, loadingCountries]);

  // Poll our own backend (not BloomSMS directly) for the SMS code, every
  // 3s, up to 3 minutes. Stops when a code shows up or on unmount.
  useEffect(() => {
    if (!lastRented?.activationId) return;

    setSmsCode(null);
    setWaitingForCode(true);

    let cancelled = false;
    let timer = null;
    const activationId = lastRented.activationId;
    const startedAt = Date.now();
    const TIMEOUT_MS = 3 * 60 * 1000;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await api.get(`/activations/${activationId}/code`);
        if (cancelled) return;
        if (res.data && res.data.code) {
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
      timer = setTimeout(poll, 3000);
    }

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [lastRented?.activationId]);

  async function handleRent(service) {
    if (rentingService) return; // one rental at a time -- this spends money
    setRentingService(service.api_name);
    setError("");
    setLastRented(null);
    try {
      const res = await api.post("/activations/rent", {
        service: service.api_name,
        country: selectedCountry,
      });

      // Show the number immediately: the money is already spent, so a
      // failure in refreshUser() below must never hide it from the user.
      // ASSUMPTION FLAGGED: response keys are `number` and `activation_id`
      // (falling back to `id`). Adjust if your backend names them differently.
      setLastRented({
        number: res.data.number || res.data.phone_number,
        service: service.display_name,
        activationId: res.data.activation_id || res.data.id,
      });

      try {
        if (typeof refreshUser === "function") await refreshUser();
      } catch {
        // Balance refresh failed; the rental itself succeeded.
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setRentingService(null);
    }
  }

  const query = search.toLowerCase();
  const filtered = services.filter((s) =>
    (s.display_name || "").toLowerCase().includes(query)
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
                      disabled={s.stock <= 0 || rentingService !== null}
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

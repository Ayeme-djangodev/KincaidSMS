import { useEffect, useRef, useState } from "react";
import api, { extractErrorMessage } from "../api";
import { formatNaira } from "../utils/currency";

// MERGED from two drafts (2026-09-24):
// - Kept from the fuller draft: asArray safety net (defends against the
//   SPA-fallback-returns-index.html-as-200 bug that caused a blank page
//   before), searchable country combobox with retry-on-failure, and the
//   top-5-by-stock default list (matching the same pattern just applied
//   to Services.jsx and TextVerifiedServices.jsx for consistency).
// - Fixed from the fuller draft: it polled a NONEXISTENT
//   /activations/{id}/code endpoint (your activations.py router only
//   has /activations/{id}/poll) and referenced a `full_text` field
//   ActivationOut doesn't have -- both silently never worked, the 404
//   just got swallowed for the full 3-minute timeout. Reverted to the
//   correct /poll endpoint and the real field names (id, number, code)
//   confirmed against activations.py / schemas.py.
const asArray = (v) => (Array.isArray(v) ? v : []);

const DEFAULT_COUNTRY = "187"; // United States, BloomSMS's own default
const TOP_COUNT = 5;

// Accept a few plausible field names so the picker still works if the
// backend passes BloomSMS's raw {id, name} through or renames fields.
function normalizeCountry(c) {
  const code = c?.code ?? c?.id ?? c?.country_id ?? "";
  const name = c?.name ?? c?.country ?? c?.label ?? c?.country_name ?? "";
  return { code: String(code), name: String(name) };
}

export default function BloomSMSServices({ refreshUser }) {
  const [services, setServices] = useState([]);
  const [countries, setCountries] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingCountries, setLoadingCountries] = useState(true);
  const [countriesFailed, setCountriesFailed] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [rentingService, setRentingService] = useState(null);
  const [lastRented, setLastRented] = useState(null); // { number, service, activationId }
  const [smsCode, setSmsCode] = useState(null); // { code }
  const [waitingForCode, setWaitingForCode] = useState(false);

  // Country picker state
  const [countryOpen, setCountryOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [countriesReload, setCountriesReload] = useState(0);
  const pickerRef = useRef(null);

  // Load countries (again if the user hits Retry).
  useEffect(() => {
    let ignore = false;

    async function loadCountries() {
      setLoadingCountries(true);
      setCountriesFailed(false);
      try {
        const res = await api.get("/services/bloomsms/countries");
        if (ignore) return;
        const list = asArray(res.data)
          .map(normalizeCountry)
          .filter((c) => c.code !== "" && c.name !== "");
        setCountries(list);
        if (list.length === 0) {
          setCountriesFailed(true);
        } else {
          // Prefer the US (BloomSMS's default) over whatever happens to be first.
          const preferred = list.find((c) => c.code === DEFAULT_COUNTRY) || list[0];
          setSelectedCountry((prev) => prev || preferred.code);
        }
      } catch (err) {
        if (!ignore) {
          setCountriesFailed(true);
          setError(extractErrorMessage(err));
        }
      } finally {
        if (!ignore) setLoadingCountries(false);
      }
    }

    loadCountries();
    return () => {
      ignore = true;
    };
  }, [countriesReload]);

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

  // Close the country list on outside click or Escape.
  useEffect(() => {
    if (!countryOpen) return;

    function close() {
      setCountryOpen(false);
      setCountrySearch("");
    }
    function onMouseDown(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) close();
    }
    function onKeyDown(e) {
      if (e.key === "Escape") close();
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [countryOpen]);

  // Poll GET /activations/{id}/poll (the real endpoint -- see
  // activations.py) every 3s, up to 3 minutes. Stops when a code shows
  // up or on unmount.
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
        const res = await api.get(`/activations/${activationId}/poll`);
        if (cancelled) return;
        if (res.data && res.data.code) {
          setSmsCode({ code: res.data.code });
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

  function chooseCountry(code) {
    setSelectedCountry(code);
    setCountryOpen(false);
    setCountrySearch("");
    setSearch(""); // start fresh in the new country
  }

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
      // Field names confirmed against schemas.ActivationOut: id, number.
      setLastRented({
        number: res.data.number,
        service: service.display_name,
        activationId: res.data.id,
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

  const selectedCountryName =
    countries.find((c) => c.code === selectedCountry)?.name || "";

  const countryQuery = countrySearch.trim().toLowerCase();
  const matchingCountries = countries.filter((c) =>
    c.name.toLowerCase().includes(countryQuery)
  );

  const query = search.trim().toLowerCase();

  // BloomSMS exposes no popularity metric, so "top" = most numbers in
  // stock for the selected country -- same convention as Services.jsx
  // and TextVerifiedServices.jsx.
  const topServices = [...services]
    .filter((s) => s.stock > 0)
    .sort((a, b) => b.stock - a.stock)
    .slice(0, TOP_COUNT);

  // Default view is only the top 5. Typing in the search box searches ALL
  // services for the selected country so nothing is unreachable.
  const visible = query
    ? services.filter((s) => (s.display_name || "").toLowerCase().includes(query))
    : topServices;

  return (
    <div className="container">
      <h2>Service 3</h2>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* Country picker: click, type to filter, Enter picks the first match */}
        <div className="form-group" ref={pickerRef} style={{ maxWidth: 240, flex: 1 }}>
          <input
            role="combobox"
            aria-expanded={countryOpen}
            aria-autocomplete="list"
            placeholder={
              loadingCountries
                ? "Loading countries..."
                : countryOpen
                ? "Search countries..."
                : "Select country"
            }
            value={countryOpen ? countrySearch : selectedCountryName}
            onFocus={() => setCountryOpen(true)}
            onClick={() => setCountryOpen(true)}
            onChange={(e) => {
              setCountrySearch(e.target.value);
              setCountryOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matchingCountries[0]) {
                e.preventDefault();
                chooseCountry(matchingCountries[0].code);
              }
            }}
          />

          {/* Rendered inline (not floating) so no parent's overflow/z-index can hide it */}
          {countryOpen && (
            <ul
              role="listbox"
              style={{
                margin: "4px 0 0",
                padding: 4,
                listStyle: "none",
                maxHeight: 220,
                overflowY: "auto",
                border: "1px solid var(--border, #e5e7eb)",
                borderRadius: 8,
              }}
            >
              {loadingCountries && (
                <li style={{ padding: "8px 10px", color: "var(--text-dim)" }}>
                  Loading countries...
                </li>
              )}

              {!loadingCountries && countriesFailed && (
                <li style={{ padding: "8px 10px", color: "var(--text-dim)" }}>
                  Couldn't load countries.{" "}
                  <button
                    type="button"
                    className="btn"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setCountriesReload((n) => n + 1);
                    }}
                  >
                    Retry
                  </button>
                </li>
              )}

              {!loadingCountries && !countriesFailed && matchingCountries.length === 0 && (
                <li style={{ padding: "8px 10px", color: "var(--text-dim)" }}>
                  No matching countries
                </li>
              )}

              {matchingCountries.map((c) => (
                <li
                  key={c.code}
                  role="option"
                  aria-selected={c.code === selectedCountry}
                  // onMouseDown (not onClick) so the pick lands before any blur/close logic
                  onMouseDown={(e) => {
                    e.preventDefault();
                    chooseCountry(c.code);
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: c.code === selectedCountry ? 600 : 400,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "rgba(127,127,127,0.12)")
                  }
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {c.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="form-group" style={{ maxWidth: 320, flex: 1 }}>
          <input
            placeholder={
              selectedCountryName
                ? `Search all services in ${selectedCountryName}...`
                : "Search all services..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
            </div>
          ) : waitingForCode ? (
            <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
              Waiting for SMS code...
            </div>
          ) : (
            <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
              No code received yet — check "My Rentals" for updates.
            </div>
          )}
        </div>
      )}

      <div className="card">
        {loading ? (
          <div>Loading services...</div>
        ) : (
          <>
            <h3 style={{ margin: "0 0 4px" }}>
              {query
                ? `Results for "${search.trim()}"`
                : `Top ${TOP_COUNT}${selectedCountryName ? ` in ${selectedCountryName}` : ""}`}
            </h3>
            {!query && (
              <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 8 }}>
                Most numbers in stock right now. Use the search box to find any other service.
              </div>
            )}
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
                {visible.map((s) => (
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
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--text-dim)" }}>
                      {query ? "No services found." : "No services in stock for this country."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

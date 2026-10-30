import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api, { extractErrorMessage } from "../api";
import { formatNaira } from "../utils/currency";
import "./buy.css";

// ONE buy flow for every provider.
//
// The backend (/offers) merges all providers' catalogs and returns each
// service with its offers already sorted cheapest-first (in-stock first).
// Customers only ever see "Option 1/2/3" -- never a provider name. The
// opaque `route` on each offer says which existing rent endpoint to call:
//   s1 -> /rentals        s2 -> /verifications        s3 -> /activations
// Renting, charging and refunds all still happen in those endpoints.

const DEFAULT_COUNTRY = "187"; // United States
const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;
// Headroom between the price the customer saw and the ceiling we send, so
// a small FX movement between "list" and "rent" doesn't cause a false
// failure. The provider still refuses anything above this ceiling.
const PRICE_HEADROOM = 1.03;

const ROUTES = {
  s1: { base: "/rentals", body: (o) => ({ service: o.api_name }) },
  s2: { base: "/verifications", body: (o) => ({ service: o.api_name }) },
  s3: { base: "/activations", body: (o, country) => ({ service: o.api_name, country }) },
};

const asArray = (v) => (Array.isArray(v) ? v : []);

function normalizeCountry(c) {
  return {
    code: String(c?.code ?? c?.id ?? c?.country_id ?? ""),
    name: String(c?.name ?? c?.country ?? c?.label ?? c?.country_name ?? ""),
  };
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (insecure context); the text is still on screen.
    }
  }
  return (
    <button type="button" className="kb-icon-btn" onClick={copy} aria-label={label}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function Buy({ refreshUser, embedded = false, onRented }) {
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [countries, setCountries] = useState([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search.trim(), 300);

  const [groups, setGroups] = useState([]);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedKey, setSelectedKey] = useState(null);
  const [offerIdx, setOfferIdx] = useState(0);

  const [renting, setRenting] = useState(false);
  const [order, setOrder] = useState(null);
  // order: { route, id, number, code, status, serviceName, timedOut }
  const [cancelling, setCancelling] = useState(false);
  const orderRef = useRef(null);

  // Countries (only matter for the offers that are tied to a country).
  useEffect(() => {
    let ignore = false;
    api
      .get("/services/bloomsms/countries")
      .then((res) => {
        if (ignore) return;
        const list = asArray(res.data)
          .map(normalizeCountry)
          .filter((c) => c.code && c.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        setCountries(list);
      })
      .catch(() => {
        // Non-fatal: the picker just stays on the default country.
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Offers: popular services by default, or search results.
  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await api.get("/offers", {
          params: { country, ...(debouncedSearch ? { q: debouncedSearch, limit: 30 } : {}) },
        });
        if (ignore) return;
        setGroups(asArray(res.data?.groups));
        setDegraded(Boolean(res.data?.degraded));
      } catch (err) {
        if (ignore) return;
        setGroups([]);
        setError(extractErrorMessage(err));
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [country, debouncedSearch]);

  // Keep a valid service selected whenever the list changes.
  useEffect(() => {
    if (groups.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!groups.some((g) => g.key === selectedKey)) {
      setSelectedKey(groups[0].key);
      setOfferIdx(0);
    }
  }, [groups, selectedKey]);

  const selected = useMemo(
    () => groups.find((g) => g.key === selectedKey) || null,
    [groups, selectedKey]
  );
  const offers = selected?.offers || [];
  const offer = offers[offerIdx] && offers[offerIdx].stock > 0 ? offers[offerIdx] : null;
  const countryName = countries.find((c) => c.code === country)?.name || "";

  function chooseService(key) {
    setSelectedKey(key);
    setOfferIdx(0); // cheapest in-stock offer is always first
  }

  function chooseCountry(code) {
    setCountry(code);
    setSearch("");
    setOfferIdx(0);
  }

  // After renting, bring the new order card into view: on a phone it sits
  // below the buy button, off screen.
  const orderId = order?.id;
  useEffect(() => {
    if (!orderId || !orderRef.current) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    orderRef.current.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
  }, [orderId]);

  // Poll the active order for its code.
  const pollRoute = order?.route;
  const pollId = order?.id;
  const pollActive = order?.status === "active" && !order?.code && !order?.timedOut;
  useEffect(() => {
    if (!pollActive) return;
    let cancelled = false;
    let timer = null;
    const startedAt = Date.now();
    const base = ROUTES[pollRoute].base;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await api.get(`${base}/${pollId}/poll`);
        if (cancelled) return;
        const data = res.data || {};
        if (data.code || (data.status && data.status !== "active")) {
          setOrder((o) => (o && o.id === pollId ? { ...o, code: data.code || null, status: data.status || o.status } : o));
          if (data.code) return;
          if (data.status && data.status !== "active") return;
        }
      } catch {
        // A transient poll failure shouldn't end the loop.
      }
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setOrder((o) => (o && o.id === pollId ? { ...o, timedOut: true } : o));
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollActive, pollRoute, pollId]);

  const handleRent = useCallback(async () => {
    if (!offer || renting) return; // one at a time -- this spends money
    const route = ROUTES[offer.route];
    if (!route) return;
    setRenting(true);
    setError("");
    try {
      const res = await api.post(`${route.base}/rent`, {
        ...route.body(offer, country),
        max_price_naira: Math.ceil(offer.price_naira * PRICE_HEADROOM * 100) / 100,
      });
      // The money is already spent: show the number immediately, and never
      // let a failed balance refresh hide it.
      setOrder({
        route: offer.route,
        id: res.data.id,
        number: res.data.number,
        code: res.data.code || null,
        status: res.data.status || "active",
        serviceName: selected?.display_name || "",
        timedOut: false,
      });
      // Let a host page (the Dashboard) reload its own lists right away.
      if (typeof onRented === "function") onRented();
      try {
        if (typeof refreshUser === "function") await refreshUser();
      } catch {
        // The rental itself succeeded.
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setRenting(false);
    }
  }, [offer, renting, country, selected, refreshUser, onRented]);

  async function handleCancel() {
    if (!order || cancelling) return;
    setCancelling(true);
    setError("");
    try {
      const res = await api.post(`${ROUTES[order.route].base}/${order.id}/cancel`);
      setOrder((o) => (o ? { ...o, status: res.data?.status || "cancelled" } : o));
      try {
        if (typeof refreshUser === "function") await refreshUser();
      } catch {
        // Cancel worked; balance will refresh on the next load.
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  const waiting = order && order.status === "active" && !order.code && !order.timedOut;

  return (
    <div className={`kb-root${embedded ? " kb-embedded" : ""}`}>
      <div className="kb-head">
        <h1 className="kb-title">Get a number for verification</h1>
        <p className="kb-sub">Pick a service, choose a price, receive your code.</p>
      </div>

      <div className="kb-field">
        <label className="kb-label" htmlFor="kb-search">Service</label>
        <input
          id="kb-search"
          className="kb-input"
          type="search"
          placeholder="Search services"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
      </div>

      {error && <div className="kb-error" role="alert">{error}</div>}
      {degraded && !error && (
        <div className="kb-notice">Some prices may be missing right now. Refresh in a moment for the full list.</div>
      )}

      {loading && groups.length === 0 ? (
        <div className="kb-muted">Loading services...</div>
      ) : groups.length === 0 ? (
        <div className="kb-muted">
          {debouncedSearch ? "No services found." : "No services in stock for this country."}
        </div>
      ) : (
        <div className="kb-tiles" role="group" aria-label="Services">
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              className={`kb-tile${g.key === selectedKey ? " is-selected" : ""}`}
              aria-pressed={g.key === selectedKey}
              onClick={() => chooseService(g.key)}
            >
              <span className="kb-tile-mark" aria-hidden="true">
                {(g.display_name || "?").charAt(0).toUpperCase()}
              </span>
              <span className="kb-tile-name">{g.display_name}</span>
              {g.min_price_naira != null && (
                <span className="kb-tile-price">from {formatNaira(g.min_price_naira)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="kb-field">
        <label className="kb-label" htmlFor="kb-country">Country</label>
        <select
          id="kb-country"
          className="kb-input kb-select"
          value={country}
          onChange={(e) => chooseCountry(e.target.value)}
        >
          {countries.length === 0 && <option value={DEFAULT_COUNTRY}>United States</option>}
          {countries.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
      </div>

      {selected && (
        <div className="kb-field">
          <div className="kb-label-row">
            <span className="kb-label" id="kb-offers-label">Choose a price</span>
            <span className="kb-hint">Cheapest first</span>
          </div>
          <div className="kb-offers" role="radiogroup" aria-labelledby="kb-offers-label">
            {offers.map((o, i) => {
              const inStock = o.stock > 0;
              const isSelected = inStock && i === offerIdx;
              return (
                <button
                  key={`${o.route}:${o.api_name}`}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={!inStock}
                  className={`kb-offer${isSelected ? " is-selected" : ""}`}
                  onClick={() => setOfferIdx(i)}
                >
                  <span className="kb-radio" aria-hidden="true">
                    {isSelected && <span className="kb-radio-dot" />}
                  </span>
                  <span className="kb-offer-body">
                    <span className="kb-offer-name">Option {i + 1}</span>
                    <span className="kb-offer-note">
                      {inStock ? `${o.stock} in stock` : "Out of stock"}
                      {inStock && o.needs_country && countryName ? ` · ${countryName}` : ""}
                    </span>
                  </span>
                  <span className="kb-offer-side">
                    {i === 0 && inStock && <span className="kb-tag">Cheapest</span>}
                    <span className="kb-price">{formatNaira(o.price_naira)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        className="kb-cta"
        disabled={!offer || renting}
        onClick={handleRent}
      >
        <span>{renting ? "Getting your number..." : "Get number"}</span>
        {offer && !renting && <span className="kb-cta-price">{formatNaira(offer.price_naira)}</span>}
      </button>

      {order && (
        <div className="kb-order" aria-live="polite" ref={orderRef}>
          <div className="kb-order-head">
            <h2 className="kb-order-title">{order.serviceName || "Your number"}</h2>
            <span className={`kb-status kb-status-${order.code ? "done" : order.status === "active" ? "wait" : "off"}`}>
              {order.code
                ? "Code received"
                : order.status === "active"
                ? order.timedOut
                  ? "No code yet"
                  : "Waiting for code"
                : order.status}
            </span>
          </div>

          <div className="kb-number-row">
            <span className="kb-mono kb-number">{order.number}</span>
            {order.number && <CopyButton text={order.number} label="Copy number" />}
          </div>

          {order.code ? (
            <div className="kb-code-box">
              <span className="kb-mono kb-code">{order.code}</span>
              <CopyButton text={order.code} label="Copy code" />
            </div>
          ) : waiting ? (
            <div className="kb-muted">Waiting for the SMS. This updates by itself.</div>
          ) : order.timedOut ? (
            <div className="kb-muted">No code yet. Check Rent History for updates.</div>
          ) : null}

          {order.status === "active" && !order.code && (
            <button type="button" className="kb-btn-danger" disabled={cancelling} onClick={handleCancel}>
              {cancelling ? "Cancelling..." : "Cancel and refund"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

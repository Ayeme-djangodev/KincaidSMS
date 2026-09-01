import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import { formatNaira } from "../utils/currency";
import useTransactPayDeposit from "../hooks/useTransactPayDeposit.js";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/rentals", label: "Rent History" },
  { to: "/wallet", label: "Transactions" },
];

export default function Sidebar({ user, refreshUser, onLogout, onNavigate }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [rate, setRate] = useState(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [amount, setAmount] = useState("5000.00");

  const { startDeposit, loading, error, setError } = useTransactPayDeposit({
    onSuccess: async () => {
      await refreshUser();
      setTopUpOpen(false);
    },
  });

  useEffect(() => {
    if (!user) return;
    api
      .get("/fx/rate")
      .then((res) => setRate(res.data.usd_to_ngn))
      .catch(() => setRate(null));
  }, [user]);

  function handleLogout() {
    localStorage.removeItem("token");
    onLogout();
    navigate("/login");
  }

  function handleTopUp(e) {
    e.preventDefault();
    startDeposit(parseFloat(amount));
  }

  if (!user) return null;

  const balanceNaira = rate ? (user.balance_cents / 100) * rate : null;

  return (
    <div className="sidebar" style={{ width: 220, minHeight: "100vh", padding: 16, display: "flex", flexDirection: "column", gap: 4, borderRight: "1px solid var(--text-dim)" }}>
      <Link to="/dashboard" className="brand" onClick={() => onNavigate?.()} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, textDecoration: "none" }}>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: "var(--signal)",
            color: "#1a0a03",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
          }}
        >
          K
        </span>
        KincaidSMS
      </Link>

      <nav style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 20 }}>
        {navItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => onNavigate?.()}
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              textDecoration: "none",
              background: location.pathname === item.to ? "var(--signal)" : "transparent",
              color: location.pathname === item.to ? "#1a0a03" : "inherit",
              fontWeight: location.pathname === item.to ? 600 : 400,
            }}
          >
            {item.label}
          </Link>
        ))}
        {user.is_admin && (
          <Link
            to="/admin"
            onClick={() => onNavigate?.()}
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              textDecoration: "none",
              background: location.pathname === "/admin" ? "var(--signal)" : "transparent",
              color: location.pathname === "/admin" ? "#1a0a03" : "inherit",
              fontWeight: location.pathname === "/admin" ? 600 : 400,
            }}
          >
            Admin
          </Link>
        )}
      </nav>

      <div className="card" style={{ marginTop: "auto" }}>
        <div style={{ fontSize: 12, color: "var(--text-dim)", textTransform: "uppercase" }}>
          Available balance
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>
          {balanceNaira === null ? "..." : formatNaira(balanceNaira)}
        </div>

        {!topUpOpen ? (
          <button className="btn" style={{ width: "100%" }} onClick={() => setTopUpOpen(true)}>
            Top Up
          </button>
        ) : (
          <form onSubmit={handleTopUp}>
            <div className="form-group">
              <label>Amount (₦)</label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            {error && <div className="error-text" style={{ fontSize: 12 }}>{error}</div>}
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn" disabled={loading} style={{ flex: 1 }}>
                {loading ? "Processing..." : "Pay"}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setTopUpOpen(false);
                  setError("");
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <button className="btn secondary" style={{ marginTop: 12 }} onClick={handleLogout}>
        Log out
      </button>
    </div>
  );
}

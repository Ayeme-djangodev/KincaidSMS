import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api";
import { formatNaira } from "../utils/currency";

export default function Navbar({ user, onLogout }) {
  const navigate = useNavigate();
  const [rate, setRate] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    // NAIRA FIX: the navbar was still showing raw USD ($...) while every
    // other customer-facing balance (Wallet page) shows naira-only. Since
    // this renders on every page, that was a visible inconsistency --
    // fetching the rate here the same way Wallet.jsx does.
    api
      .get("/fx/rate")
      .then((res) => setRate(res.data.usd_to_ngn))
      .catch(() => setRate(null));
  }, [user]);

  // Close the mobile menu whenever the route changes (link click) so it
  // doesn't stay open after navigating.
  function handleNavClick() {
    setMenuOpen(false);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    onLogout();
    navigate("/login");
    setMenuOpen(false);
  }

  if (!user) return null;

  const balanceNaira = rate ? (user.balance_cents / 100) * rate : null;

  return (
    <div className="navbar">
      <Link to="/services" className="brand" onClick={handleNavClick}>
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

      {/* Hamburger toggle -- only shown on mobile via CSS media query */}
      <button
        className={`hamburger${menuOpen ? " open" : ""}`}
        aria-label="Toggle menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span />
        <span />
        <span />
      </button>

      <nav className={menuOpen ? "open" : ""}>
        <Link to="/services" onClick={handleNavClick}>
          Service 1
        </Link>
        <Link to="/services/textverified" onClick={handleNavClick}>
          Service 2
        </Link>
        <Link to="/services/bloomsms" onClick={handleNavClick}>
          Service 3
        </Link>
        <Link to="/rentals" onClick={handleNavClick}>
          My Rentals
        </Link>
        <Link to="/wallet" onClick={handleNavClick}>
          Wallet
        </Link>
        <span className="balance">
          {balanceNaira === null ? "..." : formatNaira(balanceNaira)}
        </span>
        <button className="btn secondary" onClick={handleLogout}>
          Log out
        </button>
      </nav>
    </div>
  );
}

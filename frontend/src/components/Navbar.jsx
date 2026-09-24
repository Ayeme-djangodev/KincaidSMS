import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api";
import { formatNaira } from "../utils/currency";
import {
  IconHamburger,
  IconGear,
  IconBell,
  IconChevronDown,
} from "./AppIcons.jsx";

// REDESIGN (RockySMS-style top app bar): the plain text balance in
// .navbar .balance is now the pill-shaped .balance-pill, and the plain
// "Log out" button is replaced with a settings icon, bell icon, and
// avatar-with-chevron cluster -- clicking the avatar reveals the
// logout action, matching the screenshot's dropdown affordance instead
// of a permanently-visible Log out button taking up bar space.

export default function Navbar({ user, onLogout }) {
  const navigate = useNavigate();
  const [rate, setRate] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false); // mobile hamburger nav
  const [accountOpen, setAccountOpen] = useState(false); // avatar dropdown

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

  function handleNavClick() {
    setMenuOpen(false);
  }

  if (!user) return null;

  const balanceNaira = rate ? (user.balance_cents / 100) * rate : null;
  const initial = (user.email || "?").charAt(0).toUpperCase();

  return (
    <div className="navbar" style={{ position: "relative" }}>
      <button
        className="icon-btn"
        aria-label="Toggle menu"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <IconHamburger width={18} height={18} />
      </button>

      <div className="balance-pill">
        <span className="dot" />
        {balanceNaira === null ? "..." : formatNaira(balanceNaira)}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="icon-btn" aria-label="Settings">
          <IconGear width={18} height={18} />
        </button>
        <button className="icon-btn" aria-label="Notifications">
          <IconBell width={18} height={18} />
        </button>

        <div style={{ position: "relative" }}>
          <button
            onClick={() => setAccountOpen((open) => !open)}
            aria-label="Account menu"
            aria-expanded={accountOpen}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "none",
              border: "none",
              padding: 0,
            }}
          >
            <div className="avatar-circle">{initial}</div>
            <IconChevronDown color="var(--text-dim)" />
          </button>

          {accountOpen && (
            <div
              className="card"
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                minWidth: 180,
                padding: 8,
                margin: 0,
                zIndex: 50,
              }}
            >
              <Link
                to="/wallet"
                className="btn ghost"
                style={{ width: "100%", justifyContent: "flex-start" }}
                onClick={() => setAccountOpen(false)}
              >
                Wallet
              </Link>
              <button
                className="btn ghost"
                style={{ width: "100%", justifyContent: "flex-start", color: "var(--danger)" }}
                onClick={handleLogout}
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </div>

      {menuOpen && (
        <nav
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "var(--surface)",
            borderBottom: "1px solid var(--border-soft)",
            display: "flex",
            flexDirection: "column",
            padding: "12px 24px",
            gap: 4,
            zIndex: 50,
          }}
        >
          <Link to="/services" onClick={handleNavClick}>Service 1</Link>
          <Link to="/services/textverified" onClick={handleNavClick}>Service 2</Link>
          <Link to="/services/bloomsms" onClick={handleNavClick}>Service 3</Link>
          <Link to="/rentals" onClick={handleNavClick}>My Rentals</Link>
          <Link to="/wallet" onClick={handleNavClick}>Wallet</Link>
        </nav>
      )}
    </div>
  );
}

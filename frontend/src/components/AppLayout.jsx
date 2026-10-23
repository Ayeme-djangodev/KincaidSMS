import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import useIsMobile from "../hooks/useIsMobile.js";
import useBalanceNaira from "../hooks/useBalanceNaira.js";
import { formatNaira } from "../utils/currency";
import "./app-shell.css";

// Phones get a slim header (logo, balance, account menu) and a bottom tab
// bar. Everything else keeps the sidebar. The tab bar replaces the old
// hamburger drawer: the four things customers actually do are one tap away.

const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
};

const TABS = [
  {
    to: "/buy",
    label: "Buy",
    icon: (
      <svg {...svgProps}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
  {
    to: "/dashboard",
    label: "Active",
    icon: (
      <svg {...svgProps}>
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
      </svg>
    ),
  },
  {
    to: "/rentals",
    label: "History",
    icon: (
      <svg {...svgProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    to: "/wallet",
    label: "Wallet",
    icon: (
      <svg {...svgProps}>
        <rect x="3" y="6" width="18" height="13" rx="3" />
        <path d="M3 10h18" />
      </svg>
    ),
  },
];

export default function AppLayout({ user, refreshUser, onLogout, children }) {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const balanceNaira = useBalanceNaira(user);
  const [menuOpen, setMenuOpen] = useState(false);

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "?";

  // Close the account menu on navigation and on Escape.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(e) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  function handleLogout() {
    localStorage.removeItem("token");
    setMenuOpen(false);
    onLogout();
    navigate("/login");
  }

  if (!isMobile) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <div style={{ display: "flex" }}>
          <Sidebar user={user} refreshUser={refreshUser} onLogout={onLogout} />
          <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <header className="shell-header">
        <Link to="/buy" className="shell-brand">
          <span className="shell-logo" aria-hidden="true">K</span>
          KincaidSMS
        </Link>
        <div className="shell-actions">
          <Link to="/wallet" className="balance-pill" aria-label="Wallet balance. Tap to top up.">
            {balanceNaira === null ? "..." : formatNaira(balanceNaira)}
          </Link>
          <button
            type="button"
            className="avatar-btn"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {initials}
          </button>
        </div>
      </header>

      {menuOpen && (
        <>
          <div className="shell-scrim" onClick={() => setMenuOpen(false)} />
          <div className="account-menu" role="menu">
            {user?.email && <div className="account-email">{user.email}</div>}
            {user?.is_admin && (
              <Link to="/admin" role="menuitem">Admin</Link>
            )}
            <button type="button" role="menuitem" className="danger-item" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </>
      )}

      <main className="shell-main">{children}</main>

      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => {
          const active = location.pathname === t.to || location.pathname.startsWith(`${t.to}/`);
          return (
            <Link key={t.to} to={t.to} className="tab" aria-current={active ? "page" : undefined}>
              {t.icon}
              <span>{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

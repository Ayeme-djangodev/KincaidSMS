import { useState } from "react";
import Sidebar from "./Sidebar.jsx";
import useIsMobile from "../hooks/useIsMobile.js";

export default function AppLayout({ user, refreshUser, onLogout, children }) {
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "?";

  return (
    <div style={{ minHeight: "100vh" }}>
      {isMobile && (
        <div
          className="card"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderRadius: 0,
            marginBottom: 0,
          }}
        >
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            style={{
              background: "none",
              border: "none",
              fontSize: 22,
              lineHeight: 1,
              cursor: "pointer",
              padding: 4,
              color: "inherit",
            }}
          >
            ☰
          </button>
          <span style={{ fontWeight: 700 }}>KincaidSMS</span>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "var(--signal)",
              color: "#1a0a03",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {initials}
          </span>
        </div>
      )}

      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 30,
          }}
        />
      )}

      <div style={{ display: "flex" }}>
        <div
          className={isMobile ? "card" : undefined}
          style={
            isMobile
              ? {
                  position: "fixed",
                  top: 0,
                  left: 0,
                  height: "100vh",
                  zIndex: 31,
                  borderRadius: 0,
                  margin: 0,
                  transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
                  transition: "transform 0.2s ease",
                }
              : undefined
          }
        >
          <Sidebar
            user={user}
            refreshUser={refreshUser}
            onLogout={onLogout}
            onNavigate={() => setDrawerOpen(false)}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}

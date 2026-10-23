import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import api from "./api";
import AppLayout from "./components/AppLayout.jsx";
import PrivateRoute from "./components/PrivateRoute.jsx";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Buy from "./pages/Buy.jsx";
import Rentals from "./pages/Rentals.jsx";
import Wallet from "./pages/Wallet.jsx";
import AdminPanel from "./pages/AdminPanel.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api.get("/auth/me");
      setUser(res.data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Logged-in pages get the sidebar layout; Home/Login/Register stay
  // full-width without it (there's no user to show a sidebar for yet).
  function withSidebar(element) {
    return (
      <AppLayout user={user} refreshUser={refreshUser} onLogout={() => setUser(null)}>
        {element}
      </AppLayout>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login onLoggedIn={refreshUser} />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/dashboard"
        element={
          <PrivateRoute user={user} loading={loading}>
            {withSidebar(<Dashboard user={user} refreshUser={refreshUser} />)}
          </PrivateRoute>
        }
      />
      <Route
        path="/buy"
        element={
          <PrivateRoute user={user} loading={loading}>
            {withSidebar(<Buy refreshUser={refreshUser} />)}
          </PrivateRoute>
        }
      />
      {/* The three old per-provider pages were merged into /buy. Keep the
          old URLs working for bookmarks. */}
      <Route path="/services" element={<Navigate to="/buy" replace />} />
      <Route path="/services/textverified" element={<Navigate to="/buy" replace />} />
      <Route path="/services/bloomsms" element={<Navigate to="/buy" replace />} />
      <Route
        path="/rentals"
        element={
          <PrivateRoute user={user} loading={loading}>
            {withSidebar(<Rentals refreshUser={refreshUser} />)}
          </PrivateRoute>
        }
      />
      <Route
        path="/wallet"
        element={
          <PrivateRoute user={user} loading={loading}>
            {withSidebar(<Wallet user={user} refreshUser={refreshUser} />)}
          </PrivateRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <PrivateRoute user={user} loading={loading}>
            {user && !user.is_admin
              ? <div style={{ padding: 20 }}>Not authorized.</div>
              : withSidebar(<AdminPanel />)}
          </PrivateRoute>
        }
      />
    </Routes>
  );
}

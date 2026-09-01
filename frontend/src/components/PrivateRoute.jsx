import { Navigate } from "react-router-dom";

export default function PrivateRoute({ user, loading, children }) {
  if (loading) return <div className="container">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

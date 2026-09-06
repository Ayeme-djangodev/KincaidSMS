import axios from "axios";

// In production this app is served from the SAME Render service as the
// API (see main.py's SPA catch-all), so requests should just be relative
// -- that way they always hit whatever domain the page itself is on,
// with no CORS involved and no URL to keep in sync if the domain ever
// changes. Locally, Vite serves the frontend on its own dev port, so we
// still need an absolute URL to reach the separately-running backend.
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? "" : "http://localhost:8000");

const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export function extractErrorMessage(err) {
  return err?.response?.data?.detail || err?.message || "Something went wrong";
}

export default api;

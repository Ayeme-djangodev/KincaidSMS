import { useEffect, useState } from "react";
import api from "../api";
import { formatNaira } from "../utils/currency";
import useTransactPayDeposit from "../hooks/useTransactPayDeposit.js";

export default function Wallet({ user, refreshUser }) {
  const [transactions, setTransactions] = useState([]);
  const [amount, setAmount] = useState("5000.00");
  const [rate, setRate] = useState(null);

  const { startDeposit, loading, error } = useTransactPayDeposit({
    onSuccess: async () => {
      await refreshUser();
      await loadTransactions();
    },
  });

  async function loadTransactions() {
    const res = await api.get("/wallet/transactions");
    setTransactions(res.data);
  }

  async function loadRate() {
    const res = await api.get("/fx/rate");
    setRate(res.data.usd_to_ngn);
  }

  useEffect(() => {
    loadTransactions();
    loadRate();
  }, []);

  function handleDeposit(e) {
    e.preventDefault();
    startDeposit(parseFloat(amount));
  }

  const balanceNaira = rate ? (user.balance_cents / 100) * rate : null;

  return (
    <div className="container">
      <h2>Wallet</h2>

      <div className="card">
        <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Current balance</div>
        <div style={{ fontSize: 32, fontWeight: 700 }}>
          {balanceNaira === null ? "Loading..." : formatNaira(balanceNaira)}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Add funds</h3>
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          Secure payment via TransactPay. Enter an amount and you'll be
          taken to the payment window.
        </p>
        <form onSubmit={handleDeposit}>
          <div className="form-group" style={{ maxWidth: 200 }}>
            <label>Amount (₦)</label>
            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn" disabled={loading}>
            {loading ? "Processing..." : "Add funds"}
          </button>
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Transaction history</h3>
        <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Balance after</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.created_at).toLocaleString()}</td>
                <td>{t.type}</td>
                <td>{t.description}</td>
                <td style={{ color: t.amount_cents >= 0 ? "var(--success)" : "var(--danger)" }}>
                  {t.amount_cents >= 0 ? "+" : ""}
                  {rate ? formatNaira((t.amount_cents / 100) * rate) : "..."}
                </td>
                <td>
                  {rate ? formatNaira((t.balance_after_cents / 100) * rate) : "..."}
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--text-dim)" }}>
                  No transactions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

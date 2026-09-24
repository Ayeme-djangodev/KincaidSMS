import { useEffect, useState } from "react";
import api from "../api";
import { formatNaira } from "../utils/currency";
import useTransactPayDeposit from "../hooks/useTransactPayDeposit.js";
import {
  IconWallet,
  IconCheck,
  IconShoppingBag,
  IconArrowDown,
  IconCard,
  IconRepeat,
} from "../components/AppIcons.jsx";

// REDESIGN (RockySMS-style wallet card): the old plain "Current balance"
// card is now .wallet-card with the icon badge + verified check + stat
// row (purchases / deposited / spent / transactions) computed from the
// same /wallet/transactions data already being fetched -- no new
// endpoint needed. "Add funds" becomes the full-width pill CTA inline
// under the stat row instead of a separate card+form below it, matching
// the screenshot's single combined card.

export default function Wallet({ user, refreshUser }) {
  const [transactions, setTransactions] = useState([]);
  const [amount, setAmount] = useState("5000.00");
  const [rate, setRate] = useState(null);
  const [showDepositForm, setShowDepositForm] = useState(false);

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

  // Derived stats from the same transaction list the table already uses
  // -- no new backend work required for this redesign.
  const purchaseCount = transactions.filter((t) => t.type === "rental_charge").length;
  const depositedCents = transactions
    .filter((t) => t.type === "deposit")
    .reduce((sum, t) => sum + t.amount_cents, 0);
  const spentCents = transactions
    .filter((t) => t.type === "rental_charge")
    .reduce((sum, t) => sum + Math.abs(t.amount_cents), 0);
  const transactionCount = transactions.length;

  return (
    <div className="container">
      <h2 style={{ marginBottom: 16 }}>Wallet</h2>

      <div className="wallet-card">
        <div className="wallet-card-top">
          <div className="wallet-icon-wrap">
            <div className="wallet-icon">
              <IconWallet width={22} height={22} />
            </div>
            <div className="wallet-icon-badge">
              <IconCheck />
            </div>
          </div>
          <div>
            <div className="wallet-label">
              <span className="dot" />
              Wallet balance
            </div>
            <div className="wallet-balance-figure">
              {balanceNaira === null ? "Loading..." : formatNaira(balanceNaira)}
            </div>
          </div>
        </div>

        <div className="wallet-stat-row">
          <div className="wallet-stat">
            <span className="icon"><IconShoppingBag width={15} height={15} /></span>
            <strong>{purchaseCount}</strong> purchases
          </div>
          <div className="wallet-stat">
            <span className="icon"><IconArrowDown width={15} height={15} /></span>
            <strong>{rate ? formatNaira((depositedCents / 100) * rate) : "..."}</strong> deposited
          </div>
          <div className="wallet-stat">
            <span className="icon"><IconCard width={15} height={15} /></span>
            <strong>{rate ? formatNaira((spentCents / 100) * rate) : "..."}</strong> spent
          </div>
          <div className="wallet-stat">
            <span className="icon"><IconRepeat width={15} height={15} /></span>
            <strong>{transactionCount}</strong> transactions
          </div>
        </div>

        {!showDepositForm ? (
          <button className="btn pill-cta" onClick={() => setShowDepositForm(true)}>
            + Fund wallet
          </button>
        ) : (
          <form onSubmit={handleDeposit}>
            <div className="form-group" style={{ maxWidth: 200 }}>
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
            {error && <div className="error-text">{error}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn pill-cta" disabled={loading}>
                {loading ? "Processing..." : "Continue to payment"}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setShowDepositForm(false)}
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
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

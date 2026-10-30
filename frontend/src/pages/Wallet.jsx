import { useEffect, useState } from "react";
import api from "../api";
import { formatNaira } from "../utils/currency";
import useTransactPayDeposit from "../hooks/useTransactPayDeposit.js";
import useIsMobile from "../hooks/useIsMobile.js";
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

const QUICK_AMOUNTS = [1000, 2000, 5000, 10000];

const TYPE_LABELS = {
  deposit: "Deposit",
  rental_charge: "Purchase",
  rental_refund: "Refund",
  adjustment: "Adjustment",
};

export default function Wallet({ user, refreshUser }) {
  const isMobile = useIsMobile();
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
      <h1 className="page-title">Wallet</h1>

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
            <div className="chip-row" role="group" aria-label="Quick amounts">
              {QUICK_AMOUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="chip"
                  aria-pressed={parseFloat(amount) === n}
                  onClick={() => setAmount(n.toFixed(2))}
                >
                  {formatNaira(n).replace(".00", "")}
                </button>
              ))}
            </div>
            <div className="form-group" style={{ maxWidth: 240 }}>
              <label htmlFor="wallet-amount">Amount (₦)</label>
              <input
                id="wallet-amount"
                type="number"
                inputMode="decimal"
                min="1"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            {error && <div className="error-text" role="alert">{error}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn pill-cta" style={{ flex: "1 1 200px", width: "auto" }} disabled={loading}>
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
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Transaction history</h2>

        {transactions.length === 0 ? (
          <div className="empty-state">No transactions yet.</div>
        ) : isMobile ? (
          <ul className="row-list">
            {transactions.map((t) => {
              const positive = t.amount_cents >= 0;
              return (
                <li key={t.id} className="row-card">
                  <div className="row-card-top">
                    <div>
                      <div className="row-title">{TYPE_LABELS[t.type] || t.type}</div>
                      {t.description && <div className="row-sub">{t.description}</div>}
                    </div>
                    <div className={`row-amount ${positive ? "pos" : "neg"}`}>
                      {positive ? "+" : ""}
                      {rate ? formatNaira((t.amount_cents / 100) * rate) : "..."}
                    </div>
                  </div>
                  <div className="row-meta">
                    <span>
                      {new Date(t.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <span>
                      Balance {rate ? formatNaira((t.balance_after_cents / 100) * rate) : "..."}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
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
                    <td>{TYPE_LABELS[t.type] || t.type}</td>
                    <td>{t.description}</td>
                    <td style={{ color: t.amount_cents >= 0 ? "var(--success)" : "var(--danger)" }}>
                      {t.amount_cents >= 0 ? "+" : ""}
                      {rate ? formatNaira((t.amount_cents / 100) * rate) : "..."}
                    </td>
                    <td>{rate ? formatNaira((t.balance_after_cents / 100) * rate) : "..."}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

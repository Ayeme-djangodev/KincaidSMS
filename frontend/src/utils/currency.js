// src/utils/currency.js
//
// NAIRA ADDITION. Shared formatter so every page displays naira the same
// way: ₦1,234.56 (always 2 decimals, comma-grouped).

export function formatNaira(amount) {
  const n = Number(amount);
  if (Number.isNaN(n)) return "₦0.00";
  return (
    "₦" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

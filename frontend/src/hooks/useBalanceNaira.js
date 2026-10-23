import { useEffect, useState } from "react";
import api from "../api";

/**
 * The wallet ledger is stored in USD cents; customers see naira. Returns
 * the user's balance in naira (or null while the exchange rate is still
 * loading / unavailable). Shared by the sidebar (desktop) and the mobile
 * header so both show the same number.
 */
export default function useBalanceNaira(user) {
  const [rate, setRate] = useState(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let ignore = false;
    api
      .get("/fx/rate")
      .then((res) => {
        if (!ignore) setRate(res.data.usd_to_ngn);
      })
      .catch(() => {
        if (!ignore) setRate(null);
      });
    return () => {
      ignore = true;
    };
  }, [userId]);

  if (!user || !rate) return null;
  return (user.balance_cents / 100) * rate;
}

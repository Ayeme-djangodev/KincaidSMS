// src/hooks/useTransactPayDeposit.js
//
// TRANSACTPAY ADDITION.
// Wraps their Standard Kit widget (https://transactpay.readme.io/docs/standard-kit-checkout)
// so both the Sidebar top-up widget and the full Wallet page can share
// one implementation instead of duplicating the widget-launch logic.
//
// Flow: initiate (backend locks in the NGN->cents conversion + creates a
// pending DepositIntent) -> launch widget with public key/encryption key
// only -> on completion, call our OWN /verify endpoint, which
// independently re-checks with TransactPay server-side before crediting
// anything. The widget's onCompleted firing is never treated as proof of
// payment by itself -- matches their own docs' explicit recommendation.

import { useCallback, useState } from "react";
import api, { extractErrorMessage } from "../api";

const SCRIPT_URL = "https://payment-web-sdk.transactpay.ai/v1/checkout";

let scriptLoadingPromise = null;
function loadTransactPayScript() {
  if (window.CheckoutNS) return Promise.resolve();
  if (scriptLoadingPromise) return scriptLoadingPromise;
  scriptLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load the payment widget. Check your connection and try again."));
    document.body.appendChild(script);
  });
  return scriptLoadingPromise;
}

export default function useTransactPayDeposit({ onSuccess } = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const startDeposit = useCallback(
    async (amountNaira) => {
      setError("");
      if (!amountNaira || amountNaira <= 0) {
        setError("Enter a valid amount");
        return;
      }
      setLoading(true);

      try {
        await loadTransactPayScript();

        const initRes = await api.post("/wallet/deposit/initiate", {
          amount_naira: amountNaira,
        });
        const cfg = initRes.data;

        if (!window.CheckoutNS || !window.CheckoutNS.PaymentCheckout) {
          throw new Error("Payment widget failed to load");
        }

        const checkout = new window.CheckoutNS.PaymentCheckout({
          firstName: cfg.first_name,
          lastName: cfg.last_name,
          mobile: cfg.mobile,
          country: cfg.country,
          email: cfg.email,
          currency: cfg.currency,
          amount: cfg.amount_naira,
          reference: cfg.reference,
          merchantReference: cfg.reference,
          description: "Wallet top-up",
          apiKey: cfg.public_key,
          encryptionKey: cfg.encryption_key,
          onCompleted: async () => {
            try {
              const verifyRes = await api.post(`/wallet/deposit/verify/${cfg.reference}`);
              setLoading(false);
              if (verifyRes.data.status === "completed") {
                onSuccess?.(verifyRes.data);
              } else {
                // Widget says success but our server-side check hasn't
                // confirmed it yet -- the webhook backup should catch it
                // shortly. Don't silently do nothing; tell the customer.
                setError(
                  "Payment received — confirming with the processor. Refresh in a moment if your balance doesn't update."
                );
              }
            } catch (err) {
              setLoading(false);
              setError(extractErrorMessage(err));
            }
          },
          onClose: () => {
            setLoading(false);
          },
          onError: (err) => {
            setLoading(false);
            setError(err?.message || "Payment failed");
          },
        });

        checkout.init();
      } catch (err) {
        setLoading(false);
        setError(extractErrorMessage(err));
      }
    },
    [onSuccess]
  );

  return { startDeposit, loading, error, setError };
}

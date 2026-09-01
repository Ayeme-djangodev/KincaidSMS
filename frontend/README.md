# SMS Reseller (Getatext-backed)

A starter platform for reselling SMS-verification numbers on top of the
[Getatext API](https://getatext.com/api-docs). Your Getatext API key stays
on the backend only — customers never see it. Each customer has a wallet
balance in your own system; renting a number debits their wallet at your
configured markup over Getatext's price.

## Architecture

```
frontend (React + Vite)  --->  backend (FastAPI)  --->  Getatext API
                                     |
                                 SQLite/Postgres
                            (users, wallet ledger, rentals)
```

- **backend/** — FastAPI app. Holds the real Getatext API key, exposes a
  JWT-authed REST API to the frontend, tracks each customer's wallet
  balance as a ledger of transactions, and wraps the Getatext endpoints
  needed for the rental flow.
- **frontend/** — React SPA. Register/login, browse services, rent a
  number, and poll for the incoming SMS code.

## How pricing/markup works

`MARKUP_PERCENT` in `backend/.env` (default `0.20` = 20%) is applied on top
of whatever Getatext charges you. `/services` returns both `base_price_cents`
(Getatext's price) and `customer_price_cents` (what you charge). When a
rental completes, the customer is charged `getatext_cost * (1 + markup)`,
debited straight from their wallet balance — no card details or checkout
flow required at rental time, since they've already pre-funded their
account via `/wallet/deposit`.

**Before charging Getatext for a rental**, the backend converts the
customer's max-price ceiling into a base-price ceiling and passes that as
`max_price` to Getatext's `rent-a-number` call. This means Getatext itself
will refuse the rental if the real cost would exceed what the customer can
afford, rather than you eating the difference.

## Getting started

### Backend

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edit .env: set GETATEXT_API_KEY to your real key, set JWT_SECRET, etc.
uvicorn app.main:app --reload
```

API docs (Swagger UI) will be at `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173`. If your backend isn't on `localhost:8000`,
set `VITE_API_BASE_URL` in a `frontend/.env` file.

## What's implemented

- Email/password auth (JWT)
- Wallet: balance, deposit (**stub** — see below), transaction ledger
- `/services` — live prices from Getatext, marked up for customers
- Rent a random number (`/rentals/rent`) — wraps `rent-a-number`
- Rent a specific number (`/rentals/rent-specific`) — wraps `rent-specific-number`
- Poll for SMS code (`/rentals/{id}/poll`) — wraps `rental-status`
- Cancel a rental (`/rentals/{id}/cancel`) — wraps `cancel-rental`, refunds
  the wallet for the unused portion
- Mark a rental completed (`/rentals/{id}/complete`) — wraps
  `rental-status/{id}/completed`
- Frontend auto-polls active rentals every 5s for the incoming code

## What's intentionally left out / needs your attention before production

1. **Payments are stubbed.** `/wallet/deposit` currently credits the wallet
   directly with no real payment processing — anyone with an authenticated
   session can "deposit" for free. Wire this to Stripe (or your payment
   processor of choice) and only credit the wallet from a **verified
   webhook**, not a client-triggered call.
2. **Getatext's cancellation refund math is an assumption.** The docs don't
   fully specify what `cost` means in the `cancel-rental` response (prorated
   usage vs. full charge vs. something else). The current code assumes it's
   the final amount Getatext actually charged you and refunds the customer
   the difference. Confirm this with Getatext support before relying on it.
3. **No admin panel.** There's no UI for managing users, adjusting balances,
   viewing all rentals across customers, or configuring markup per-service.
   The `is_admin` flag exists on the User model as a hook for this.
4. **No rate limiting.** Getatext enforces per-second limits on some
   endpoints (2 req/s on rent-a-number, 1 req/s on others). If you expect
   concurrent customers hitting these at once, add a rate limiter/queue in
   front of the Getatext client calls.
5. **SQLite by default.** Fine for local dev; switch `DATABASE_URL` to
   Postgres for production and add Alembic migrations instead of relying on
   `Base.metadata.create_all`.
6. **Webhook receiver not implemented.** Getatext supports pushing codes to
   a webhook instead of you polling `rental-status`. Since polling was the
   chosen approach for now, this wasn't built — the `poll` endpoint on the
   backend is what your frontend calls, and it's this backend polling
   Getatext, not you polling Getatext directly from the browser. Consider
   swapping the backend to a webhook receiver later to cut API calls to
   Getatext and get codes faster.
7. **`rent-multiple-services` and long-rental endpoints are not wired up**
   (only single-service rent, cancel, status, and complete). The Getatext
   client module (`app/getatext_client.py`) is structured so adding these is
   mostly copy-pasting the existing pattern.

## Project layout

```
backend/
  app/
    main.py            FastAPI app, CORS, router registration
    config.py           Settings loaded from .env
    database.py          SQLAlchemy engine/session
    models.py             User, WalletTransaction, Rental
    schemas.py              Pydantic request/response models
    security.py               Password hashing + JWT
    deps.py                     get_current_user / get_current_admin
    getatext_client.py           Wraps the Getatext API calls
    routers/
      auth.py           register / login / me
      wallet.py           balance / deposit (stub) / transactions
      services.py           list services with your markup applied
      rentals.py               rent / poll / cancel / complete
  requirements.txt
  .env.example

frontend/
  src/
    api.js              Axios client, attaches JWT, handles 401s
    App.jsx               Routing + auth state
    pages/
      Login.jsx, Register.jsx, Services.jsx, Rentals.jsx, Wallet.jsx
    components/
      Navbar.jsx, PrivateRoute.jsx
  package.json
```

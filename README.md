# KincaidSMS

A wallet-based SMS-number reselling platform. Customers deposit funds into a wallet and rent phone numbers for SMS verification, sourced through the Getatext API and sold with a markup.

## Stack

**Backend**
- Python / FastAPI
- SQLAlchemy ORM + Alembic migrations
- PostgreSQL (production) — SQLite was used in early local development
- JWT authentication

**Frontend**
- React + Vite
- react-router-dom
- axios

**Payments**
- TransactPay (deposit/webhook-based wallet crediting)

The backend serves the built frontend directly (combined single-service deployment) rather than hosting them separately.

## Project structure

```
Kincaidsms/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app + static frontend serving
│   │   ├── security.py      # JWT auth
│   │   ├── services.py      # Getatext service/price parsing
│   │   └── ...
│   ├── alembic/
│   ├── alembic.ini
│   └── requirements.txt
└── frontend/
    ├── src/
    └── package.json
```

## Local development

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
copy .env.example .env       # Windows — use `cp` on macOS/Linux
alembic upgrade head
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Environment variables

Set these in `backend/.env` locally, and as environment variables on Render in production. Never commit `.env`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Signing secret for auth tokens |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `GETATEXT_API_KEY` | Getatext SMS number provider |
| `TEXTVERIFIED_API_KEY` / `TEXTVERIFIED_API_USERNAME` | TextVerified provider |
| `BLOOMSMS_API_KEY` | BloomSMS provider |
| `TRANSACTPAY_PUBLIC_KEY` / `TRANSACTPAY_SECRET_KEY` / `TRANSACTPAY_ENCRYPTION_KEY` | Payment gateway |
| `FX_CACHE_TTL_SECONDS` / `FX_FALLBACK_RATE_NGN` | FX conversion caching |

## Deployment

Deployed on Render as a single web service (see `PRODUCTION_DEPLOYMENT_SEQUENCE.txt` for the full go-live checklist).

- **Build:** `cd frontend && npm install && npm run build && cd ../backend && pip install -r requirements.txt`
- **Start:** `cd backend && alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT`

TransactPay webhook endpoint: `https://www.kincaidsms.com/wallet/deposit/webhook`

## Status

Actively in development. Wallet crediting via TransactPay is confirmed working; cancel/refund flow tested. See the deployment sequence doc for remaining go-live steps.

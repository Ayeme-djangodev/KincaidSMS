from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    GETATEXT_API_KEY: str
    GETATEXT_BASE_URL: str = "https://getatext.com"

    # 0.20 == 20% markup on top of Getatext's price
    MARKUP_PERCENT: float = 0.20

    # FETCH SMS INTEGRATION (previously TextVerified -- swapped 2026-09).
    # Auth is a single Bearer token, no refresh/token-expiry logic needed
    # (unlike TextVerified's bearer-refresh flow). Rate limit per their
    # docs is a generous 100 req/s per key, so no caching/pacing layer
    # is needed the way TextVerified's pricing calls required.
    FETCHSMS_API_KEY: str

    # BLOOMSMS ADDITION.
    # Static Bearer token, no refresh needed (unlike TextVerified). Their
    # docs publish a rate limit of 60 requests/min per key.
    BLOOMSMS_API_KEY: str
    BLOOMSMS_BASE_URL: str = "https://bloomsms.com/api/v1"

    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440

    # POSTGRES MIGRATION: format is
    # postgresql://USER:PASSWORD@HOST:PORT/DBNAME
    # e.g. postgresql://kincaid:yourpassword@localhost:5432/kincaid_sms
    # SQLite is still the fallback default so nothing breaks if this isn't
    # set, but production should always set this in .env.
    DATABASE_URL: str = "sqlite:///./reseller.db"

    CORS_ORIGINS: str = "http://localhost:5173"

    # NAIRA ADDITION (previously instructed, closing out here since this
    # file was never sent for me to add it to directly).
    FX_CACHE_TTL_SECONDS: int = 3600
    FX_FALLBACK_RATE_NGN: float = 1600.0

    # TRANSACTPAY ADDITION.
    # Auth is a single 'api-key' header on every request -- WHICH key
    # (public vs secret) depends on the endpoint per their own docs. The
    # Standard Kit checkout widget (client-side, in the browser) needs the
    # PUBLIC key + PUBLIC encryption key -- never the secret key, since
    # that widget config is visible in the browser. The secret key is only
    # used server-side, e.g. for the order-status verification call.
    TRANSACTPAY_PUBLIC_KEY: str
    TRANSACTPAY_SECRET_KEY: str
    TRANSACTPAY_ENCRYPTION_KEY: str  # public encryption key, used by the frontend widget
    TRANSACTPAY_BASE_URL: str = "https://payment-api-service.transactpay.ai"
    # Customers aren't asked for a phone number either -- TransactPay's
    # widget config still expects one, so every deposit uses this single
    # business-owned number instead of collecting one per customer.
    TRANSACTPAY_PLACEHOLDER_MOBILE: str = "+2348024113305"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()

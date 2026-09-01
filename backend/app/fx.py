"""
app/fx.py

Live USD -> NGN exchange rate with in-memory caching and a safe fallback.

Data source: https://open.er-api.com/v6/latest/USD
  - Free, no API key required.
  - Updates once every 24h on their end, so we cache aggressively
    (default 1 hour) rather than hitting it on every request.
  - Requires attribution per their terms: https://www.exchangerate-api.com
    (a small "Rates by Exchange Rate API" credit somewhere on your
    pricing page satisfies this).

IMPORTANT: this rate is used to CONVERT+DISPLAY prices to the customer
and to convert their NGN-denominated inputs back to USD cents for the
wallet ledger (which stays USD internally, per design decision).
If this call fails, we fall back to config.FX_FALLBACK_RATE_NGN so the
site doesn't go down — but that fallback rate WILL drift from the real
market rate over time if the live fetch keeps failing, so it's worth
logging/alerting on fallback usage in production rather than silently
eating the discrepancy.
"""

import logging
import time
from dataclasses import dataclass
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger("app.fx")

FX_API_URL = "https://open.er-api.com/v6/latest/USD"


@dataclass
class _CachedRate:
    rate: float
    fetched_at: float
    source: str  # "live" or "fallback"


_cache: Optional[_CachedRate] = None


def _cache_is_fresh() -> bool:
    if _cache is None:
        return False
    ttl = getattr(settings, "FX_CACHE_TTL_SECONDS", 3600)
    return (time.time() - _cache.fetched_at) < ttl


def _fetch_live_rate() -> Optional[float]:
    try:
        resp = httpx.get(FX_API_URL, timeout=5.0)
        resp.raise_for_status()
        data = resp.json()
        if data.get("result") != "success":
            logger.warning("FX API returned non-success result: %s", data.get("result"))
            return None
        rate = data.get("rates", {}).get("NGN")
        if rate is None:
            logger.warning("FX API response missing NGN rate: %s", data)
            return None
        return float(rate)
    except (httpx.HTTPError, ValueError, KeyError) as e:
        logger.warning("FX API fetch failed: %s", e)
        return None


def get_usd_to_ngn_rate(force_refresh: bool = False) -> float:
    """
    Returns the current USD -> NGN rate (1 USD = N naira).
    Cached for FX_CACHE_TTL_SECONDS. Falls back to
    settings.FX_FALLBACK_RATE_NGN if the live fetch fails.
    """
    global _cache

    if not force_refresh and _cache_is_fresh():
        return _cache.rate

    live_rate = _fetch_live_rate()
    if live_rate is not None:
        _cache = _CachedRate(rate=live_rate, fetched_at=time.time(), source="live")
        return live_rate

    # Live fetch failed. Reuse a stale cached rate if we have one at all,
    # rather than immediately jumping to the hardcoded fallback.
    if _cache is not None:
        logger.warning(
            "Using stale cached FX rate (%.2f, fetched %.0fs ago) after live fetch failure",
            _cache.rate,
            time.time() - _cache.fetched_at,
        )
        return _cache.rate

    fallback = getattr(settings, "FX_FALLBACK_RATE_NGN", 1600.0)
    logger.warning("No live or cached FX rate available, using hardcoded fallback: %.2f", fallback)
    _cache = _CachedRate(rate=fallback, fetched_at=time.time(), source="fallback")
    return fallback


def usd_cents_to_naira(usd_cents: int, rate: Optional[float] = None) -> float:
    """Convert a USD-cents amount to a naira amount (float, no markup applied)."""
    if rate is None:
        rate = get_usd_to_ngn_rate()
    return (usd_cents / 100.0) * rate


def naira_to_usd_cents(naira: float, rate: Optional[float] = None) -> int:
    """
    Convert a naira amount back to USD cents (for charging the USD wallet
    when the customer-facing flow is in naira). Rounds to nearest cent.
    """
    if rate is None:
        rate = get_usd_to_ngn_rate()
    return round((naira / rate) * 100)

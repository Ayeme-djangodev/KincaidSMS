"""
app/textverified_client.py

Wrapper around the TextVerified API (https://www.textverified.com/docs/api/v2).

UNLIKE getatext_client.py, this is NOT a raw httpx wrapper. TextVerified's
public docs page is a JS-rendered SPA that doesn't expose raw REST endpoint
paths/payload shapes to search or fetch, and their auth flow involves a
bearer token that expires and needs refreshing. Rather than guess at
wire-level details for a paid API -- mistakes here cost real account
balance -- this wraps TextVerified's own actively-maintained Python package,
which handles auth/token-refresh/endpoint details internally.

    pip install textverified --break-system-packages

>>> UNCERTAINTY FLAGGED: I could not fully verify the exact attribute names
on the PricingSnapshot / Service / VerificationExpanded / Sms objects this
package returns -- some detail was cut off in what I could retrieve from
their docs. This module defensively tries several plausible attribute
names via _first_attr() and LOGS the raw object on first use, same pattern
as BUG #2's fix in services.py. On your first real call, check the
terminal for lines starting with "Raw TextVerified ...:" and paste them
back if a service gets skipped or something looks wrong -- same workflow
that tuned the Getatext response parsing.

FIX 2: _wrap_call now catches ANY exception from the underlying package
call, not just their TextVerifiedError. We've now seen two different
exception types escape this module uncaught and crash the whole
/services endpoint -- first a raw ImportError, now a raw
requests.exceptions.HTTPError from a 429 rate-limit response. This
module's entire job is to make sure nothing from TextVerified's side can
ever take Getatext's working services down with it, so the net is
deliberately broad here.

FIX 3: list_services() now caches its result (services + prices) with a
TTL, and paces the per-service pricing calls with a delay, instead of
hitting TextVerified fresh (with hundreds of individual pricing calls)
on every single /services request. This is what triggered the 429 in
the first place.
"""

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Optional

from app.config import settings

logger = logging.getLogger("uvicorn.error")


class TextVerifiedClientError(Exception):
    """Raised when TextVerified returns an error or we can't parse its response."""

    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


@dataclass
class _ServicesCache:
    data: list
    fetched_at: float


def _import_tv():
    """
    Single guarded entry point for importing the 'textverified' package.
    EVERY function below that needs anything from the package goes through
    this, so a missing/broken install always surfaces as
    TextVerifiedClientError -- never a raw ImportError that could escape
    uncaught and crash a whole endpoint.
    """
    try:
        import textverified as tv
        return tv
    except ImportError as e:
        raise TextVerifiedClientError(
            "The 'textverified' package isn't installed. Run: "
            "pip install textverified --break-system-packages",
            500,
        ) from e


_client = None  # lazily-created singleton


def _get_client():
    """
    Lazily create and cache a single TextVerified client instance. The
    underlying package handles bearer-token refresh internally (per their
    docs: "Refresh the bearer token, if expired. Called automatically
    before performing actions."), so we don't need our own token-caching
    logic the way fx.py needs one for the FX rate.
    """
    global _client
    if _client is None:
        tv = _import_tv()
        _client = tv.TextVerified(
            api_key=settings.TEXTVERIFIED_API_KEY,
            api_username=settings.TEXTVERIFIED_API_USERNAME,
            base_url=settings.TEXTVERIFIED_BASE_URL,
        )
    return _client


def _wrap_call(fn, *args, **kwargs):
    """
    Run a textverified-package call, translating ANY error into ours.

    Deliberately broad (catches Exception, not just their TextVerifiedError)
    -- their package has been observed raising raw requests.HTTPError for
    HTTP-level problems like 429 rate limits, which is a completely
    different exception type from their own TextVerifiedError and would
    otherwise slip through uncaught. See module docstring.
    """
    tv = _import_tv()
    try:
        return fn(*args, **kwargs)
    except tv.TextVerifiedError as e:
        raise TextVerifiedClientError(
            f"{getattr(e, 'error_code', 'error')}: "
            f"{getattr(e, 'error_description', str(e))}",
            502,
        ) from e
    except Exception as e:
        raise TextVerifiedClientError(f"TextVerified request failed: {e}", 502) from e


def _first_attr(obj, *names, default=None):
    """
    Defensive getattr -- same idea as services.py's _first_present(), but
    for attribute access on the package's return objects instead of dict
    keys, since we're not fully certain of the exact attribute names.
    """
    for name in names:
        if hasattr(obj, name):
            val = getattr(obj, name)
            if val is not None:
                return val
    return default


def _log_raw(label: str, obj: Any):
    try:
        payload = vars(obj) if hasattr(obj, "__dict__") else obj
    except TypeError:
        payload = obj
    logger.info("Raw TextVerified %s: %r", label, payload)


def _is_rate_limit_error(e: "TextVerifiedClientError") -> bool:
    msg = e.message.lower()
    return "429" in msg or "too many requests" in msg


# --- Caching, take 2 ---------------------------------------------------
# FIX (from real rate-limit testing): the first version of this caching
# layer had two problems, both visible in the actual logs:
#
#   1. NO LOCK -- two concurrent /services requests could both see "no
#      fresh cache yet" and both start a full pricing loop at once,
#      literally doubling the real request rate against TextVerified and
#      burning through the rate limit twice as fast. This is very likely
#      why the SECOND refresh attempt got through even FEWER services
#      (40) than the first (66) -- they were racing each other.
#
#   2. NO PROGRESS CARRIED BETWEEN ATTEMPTS -- every refresh started
#      pricing from scratch at the same alphabetically-first service, hit
#      the same rate limit at roughly the same point, and discarded
#      anything already priced from a prior attempt. The catalog would
#      NEVER have grown past that same prefix no matter how many times
#      you retried.
#
# Fixed here with: (a) a lock so only one refresh runs at a time, and
# (b) a PER-SERVICE price cache that persists across calls, so each
# refresh attempt only prices services it doesn't already have a fresh
# price for -- progressively completing the catalog over several
# requests instead of repeating the same partial prefix forever.

_refresh_lock = threading.Lock()


@dataclass
class _PricedEntry:
    price: float
    fetched_at: float


_price_cache: dict = {}  # api_name -> _PricedEntry
_service_names_cache: Optional[_ServicesCache] = None  # raw name list, one cheap call


def _generic_cache_fresh(cache: Optional[_ServicesCache]) -> bool:
    if cache is None:
        return False
    ttl = settings.TEXTVERIFIED_SERVICES_CACHE_TTL_SECONDS
    return (time.time() - cache.fetched_at) < ttl


def _fetch_service_names() -> list[str]:
    """
    The cheap part: ONE call to services.list() to get the full set of
    service names. Cached separately from pricing (pricing is the
    expensive, rate-limited part) since this alone doesn't hit the limit.
    """
    global _service_names_cache
    if _generic_cache_fresh(_service_names_cache):
        return _service_names_cache.data

    tv = _import_tv()
    client = _get_client()
    services = _wrap_call(
        client.services.list,
        number_type=tv.NumberType.MOBILE,
        reservation_type=tv.ReservationType.VERIFICATION,
    )
    if services:
        _log_raw("services.list() first item", services[0])

    names = []
    for svc in services:
        api_name = _first_attr(svc, "service_name", "name", "id")
        if api_name is None:
            logger.warning("Skipping unrecognized TextVerified service row: %r", svc)
            continue
        names.append(api_name)

    _service_names_cache = _ServicesCache(data=names, fetched_at=time.time())
    return names


def search_services(query: str, limit: int = 8) -> list[dict]:
    """
    Search-driven alternative to list_services(). Rather than pricing the
    ENTIRE TextVerified catalog (which is what triggered the rate-limit
    problems), this only prices services matching the search query,
    capped at `limit`. Reuses the same _price_cache list_services() uses,
    so a service already priced from a prior search (or a prior bulk
    refresh) doesn't need re-fetching -- searches for common terms get
    fast/free after the first hit.
    """
    names = _fetch_service_names()
    query_lower = query.strip().lower()
    if not query_lower:
        return []

    matches = [n for n in names if query_lower in n.lower()][:limit]

    delay = settings.TEXTVERIFIED_PRICING_REQUEST_DELAY_SECONDS
    ttl = settings.TEXTVERIFIED_SERVICES_CACHE_TTL_SECONDS
    out = []

    for api_name in matches:
        entry = _price_cache.get(api_name)
        if entry is not None and (time.time() - entry.fetched_at) < ttl:
            price = entry.price
        else:
            try:
                price = get_verification_price(api_name)
                _price_cache[api_name] = _PricedEntry(price=price, fetched_at=time.time())
                time.sleep(delay)
            except TextVerifiedClientError as e:
                logger.warning(
                    "Could not price TextVerified service %r during search (%s), skipping",
                    api_name, e.message,
                )
                continue

        out.append({"api_name": api_name, "display_name": api_name, "base_price_usd": price})

    return out


def list_services(force_refresh: bool = False) -> list[dict]:
    """
    Returns a normalized list of dicts: [{"api_name", "display_name",
    "base_price_usd"}] for every TextVerified service CURRENTLY PRICED
    IN THE CACHE. On a cold start this may be a subset of the full
    catalog -- it grows toward completeness over successive calls as
    more services get priced (see module notes above on why).

    Only one refresh runs at a time (lock-guarded); a request that finds
    a refresh already in progress elsewhere just returns whatever's
    cached right now rather than piling on with a second parallel run.
    """
    global _price_cache

    names = _fetch_service_names()

    # Anything already fresh in the price cache doesn't need re-fetching.
    def _fresh_price(name: str) -> Optional[float]:
        entry = _price_cache.get(name)
        if entry is None:
            return None
        ttl = settings.TEXTVERIFIED_SERVICES_CACHE_TTL_SECONDS
        if (time.time() - entry.fetched_at) >= ttl:
            return None
        return entry.price

    needs_pricing = [n for n in names if not force_refresh and _fresh_price(n) is None]

    if needs_pricing:
        acquired = _refresh_lock.acquire(blocking=False)
        if not acquired:
            logger.info(
                "TextVerified pricing refresh already in progress elsewhere -- "
                "serving %d currently-cached services instead of starting a "
                "second parallel run", len(_price_cache),
            )
        else:
            try:
                delay = settings.TEXTVERIFIED_PRICING_REQUEST_DELAY_SECONDS
                priced_this_round = 0
                for api_name in needs_pricing:
                    try:
                        price = get_verification_price(api_name)
                        _price_cache[api_name] = _PricedEntry(price=price, fetched_at=time.time())
                        priced_this_round += 1
                        time.sleep(delay)
                    except TextVerifiedClientError as e:
                        if _is_rate_limit_error(e):
                            logger.warning(
                                "TextVerified rate limit hit after pricing %d NEW "
                                "services this round (%d total cached now) -- "
                                "stopping early, remaining services will be picked "
                                "up on a future call. Consider raising "
                                "TEXTVERIFIED_PRICING_REQUEST_DELAY_SECONDS.",
                                priced_this_round, len(_price_cache),
                            )
                            break
                        logger.warning(
                            "Could not price TextVerified service %r (%s), skipping",
                            api_name, e.message,
                        )
                        continue
                logger.info(
                    "TextVerified pricing round complete: %d newly priced, %d total in cache",
                    priced_this_round, len(_price_cache),
                )
            finally:
                _refresh_lock.release()

    out = []
    for api_name in names:
        entry = _price_cache.get(api_name)
        if entry is None:
            continue  # not priced yet -- will appear once a future call prices it
        out.append(
            {
                "api_name": api_name,
                "display_name": api_name,
                "base_price_usd": entry.price,
            }
        )
    return out


def get_verification_price(service_name: str, capability: str = "sms") -> float:
    """
    Price-checks a verification before creating it. Returns USD (their
    account balance is USD-denominated per their docs).

    NOTE: their pricing() call requires service_name, area_code, carrier,
    number_type, AND capability to all be explicitly provided (confirmed
    via a real ValueError from their package -- None isn't accepted for
    any of them, even to mean "no preference"). area_code/carrier are
    BOOLEANS here (whether you want a specific one), not actual values --
    False/False means "give me the general price, no area code or
    carrier preference", which matches how the rest of this app treats
    pricing (generic per-service, not location-specific).
    """
    tv = _import_tv()

    cap = tv.ReservationCapability.SMS if capability == "sms" else tv.ReservationCapability.VOICE
    client = _get_client()
    snapshot = _wrap_call(
        client.verifications.pricing,
        service_name=service_name,
        area_code=False,
        carrier=False,
        number_type=tv.NumberType.MOBILE,
        capability=cap,
    )

    _log_raw(f"pricing snapshot for {service_name!r}", snapshot)

    price = _first_attr(snapshot, "price", "total_price", "total_cost", "cost", "amount")
    if price is None:
        raise TextVerifiedClientError(
            f"Could not find a price field on TextVerified's pricing response "
            f"for {service_name!r}. Check the terminal log line above for the "
            f"raw object and report it back so the field mapping can be tuned.",
            502,
        )
    return float(price)


def create_verification(
    service_name: str, capability: str = "sms", max_price: Optional[float] = None
) -> dict:
    """
    Creates a verification (TextVerified's equivalent of Getatext's
    rent-a-number). Returns a normalized dict: {"id", "number", "cost"}.

    NOTE: max_price is accepted by their NewVerificationRequest per its
    signature, but I haven't been able to confirm it enforces a hard
    ceiling the same protective way Getatext's max_price does (Getatext
    refuses the rental outright if real cost would exceed it -- see
    design decision #2 in PROGRESS_NOTES). Worth a real test before
    trusting this to cap spend the same way.
    """
    tv = _import_tv()

    cap = tv.ReservationCapability.SMS if capability == "sms" else tv.ReservationCapability.VOICE
    client = _get_client()

    kwargs = {"service_name": service_name, "capability": cap}
    if max_price is not None:
        kwargs["max_price"] = max_price

    verification = _wrap_call(client.verifications.create, **kwargs)
    _log_raw("verification created", verification)

    vid = _first_attr(verification, "id")
    number = _first_attr(verification, "number")
    cost = _first_attr(verification, "cost", "price", "total_cost", default=0)

    if vid is None or number is None:
        raise TextVerifiedClientError(
            "TextVerified verification response missing id/number -- check "
            "the terminal log above for the raw object.",
            502,
        )

    return {"id": str(vid), "number": str(number), "cost": float(cost)}


def get_sms_code(verification_id: str) -> Optional[str]:
    """
    Polls for the SMS code on a verification. Returns None if nothing has
    arrived yet -- matches Getatext's rental_status() poll semantics, used
    the same way from the router (frontend polls every 5s).
    """
    client = _get_client()
    verification = _wrap_call(client.verifications.details, verification_id)
    messages = _wrap_call(client.sms.list, verification)

    items = list(messages) if messages is not None else []
    if not items:
        return None

    latest = items[-1]
    code = _first_attr(latest, "code", "text", "message", "body")
    return str(code) if code is not None else None


def cancel_verification(verification_id: str) -> bool:
    client = _get_client()
    return bool(_wrap_call(client.verifications.cancel, verification_id))

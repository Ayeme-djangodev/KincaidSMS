import logging
import time

from fastapi import APIRouter, Depends, HTTPException

from app import models, schemas
from app.config import settings
from app.deps import get_current_user
from app.fx import get_usd_to_ngn_rate
from app.getatext_client import prices_info, GetatextError
from app.fetchsms_client import list_services as fetchsms_list_services, FetchSMSClientError
from app.bloomsms_client import list_services as bloom_list_services, BloomSMSError

router = APIRouter(prefix="/services", tags=["services"])

logger = logging.getLogger("uvicorn.error")

# FETCH SMS INTEGRATION (previously TextVerified -- swapped 2026-09).
# Unlike TextVerified, Fetch SMS's GET /v1/services returns price_cents
# directly for every row in one call -- no per-service pricing calls
# needed, so this no longer needs the search-driven, rate-limit-avoidance
# design TextVerified required. Cached the same way as BloomSMS below,
# purely as good manners under concurrent page loads.
_fetchsms_cache = {"data": None, "fetched_at": 0.0}
_FETCHSMS_CACHE_TTL_SECONDS = 300  # 5 minutes

# BLOOMSMS ADDITION. Unlike TextVerified, BloomSMS returns price directly
# in one call (no per-service pricing needed), and their rate limit
# (60/min) is generous enough that this light caching is just good
# manners rather than a rate-limit necessity -- a few minutes' cache
# avoids hitting BloomSMS on every single page load if many customers
# browse the page around the same time.
_bloom_cache = {"data": None, "fetched_at": 0.0}
_BLOOM_CACHE_TTL_SECONDS = 300  # 5 minutes


def _to_cents(value) -> int:
    return round(float(value) * 100)


def _first_present(row: dict, *keys):
    for k in keys:
        if k in row and row[k] is not None:
            return row[k]
    return None


def _build_service_out(
    provider: str,
    api_name: str,
    display_name: str,
    base_cents: int,
    fx_rate: float,
    stock: int,
    multiple_sms: bool,
) -> schemas.ServiceOut:
    """
    Shared conversion logic for both providers so the naira/markup math
    stays identical regardless of which one a row came from.
    """
    customer_cents = round(base_cents * (1 + settings.MARKUP_PERCENT))
    base_naira = (base_cents / 100.0) * fx_rate
    customer_naira = base_naira * (1 + settings.MARKUP_PERCENT)

    return schemas.ServiceOut(
        provider=provider,
        api_name=api_name,
        display_name=display_name,
        base_price_cents=base_cents,
        customer_price_cents=customer_cents,
        base_price_naira=round(base_naira, 2),
        customer_price_naira=round(customer_naira, 2),
        fx_rate_used=fx_rate,
        stock=stock,
        multiple_sms=multiple_sms,
    )


@router.get("", response_model=list[schemas.ServiceOut])
def list_services(current_user: models.User = Depends(get_current_user)):
    """
    Getatext-only. Fetch SMS and BloomSMS each have their own bulk
    listing endpoint below (/services/fetchsms, /services/bloomsms) --
    kept separate rather than merged into one big list/call, same
    reasoning as the original TextVerified split: each provider's own
    page only pays for the calls it actually needs.
    """
    fx_rate = get_usd_to_ngn_rate()

    try:
        data = prices_info()
    except GetatextError as e:
        raise HTTPException(status_code=502, detail=f"Getatext error: {e.message}")

    logger.info("Raw /api/v1/prices-info response: %r", data)

    if isinstance(data, dict) and "prices" in data:
        rows = data["prices"]
    elif isinstance(data, dict) and "services" in data:
        rows = data["services"]
    elif isinstance(data, list):
        rows = data
    else:
        rows = [data]

    out = []
    for row in rows:
        if len(row) == 1 and not any(
            k in row for k in ("price", "cost", "api_name", "service_name")
        ):
            api_name, inner = next(iter(row.items()))
            row = {**inner, "api_name": api_name}

        price = _first_present(row, "price", "cost")
        api_name = _first_present(row, "api_name")
        display_name = _first_present(row, "service_name", "name") or api_name

        if price is None or api_name is None:
            logger.warning("Skipping unrecognized Getatext service row: %r", row)
            continue

        base_cents = _to_cents(price)
        out.append(
            _build_service_out(
                provider="getatext",
                api_name=api_name,
                display_name=display_name,
                base_cents=base_cents,
                fx_rate=fx_rate,
                stock=int(_first_present(row, "stock", "count") or 0),
                multiple_sms=str(row.get("multiple_sms", "false")).lower() == "true",
            )
        )
    return out


@router.get("/fetchsms", response_model=list[schemas.ServiceOut])
def list_fetchsms_services(current_user: models.User = Depends(get_current_user)):
    """
    Bulk listing, like Getatext's and BloomSMS's -- Fetch SMS returns
    price directly in one call, so unlike the old TextVerified endpoint
    this needed no search-driven workaround. 5 min cache purely to be
    polite to their API under concurrent page loads.
    """
    fx_rate = get_usd_to_ngn_rate()

    now = time.time()
    if _fetchsms_cache["data"] is not None and (now - _fetchsms_cache["fetched_at"]) < _FETCHSMS_CACHE_TTL_SECONDS:
        rows = _fetchsms_cache["data"]
    else:
        try:
            rows = fetchsms_list_services()
            _fetchsms_cache["data"] = rows
            _fetchsms_cache["fetched_at"] = now
        except FetchSMSClientError as e:
            logger.error("Fetch SMS error while listing services: %s", e.message)
            # Same graceful-degradation pattern as the other providers --
            # serve a stale cache if we have one rather than erroring out.
            if _fetchsms_cache["data"] is not None:
                rows = _fetchsms_cache["data"]
            else:
                raise HTTPException(status_code=502, detail=f"Fetch SMS error: {e.message}")

    return [
        _build_service_out(
            provider="fetchsms",
            api_name=row["api_name"],
            display_name=row["display_name"],
            base_cents=_to_cents(row["base_price_usd"]),
            fx_rate=fx_rate,
            stock=int(row.get("short_available") or 0),
            multiple_sms=False,
        )
        for row in rows
    ]


@router.get("/bloomsms", response_model=list[schemas.ServiceOut])
def list_bloomsms_services(current_user: models.User = Depends(get_current_user)):
    """
    Bulk listing, like Getatext's -- BloomSMS returns price and stock
    directly in one call, so there's no need for the search-driven
    approach TextVerified needed. Lightly cached (5 min) purely to be
    polite to their API under concurrent page loads, not because of any
    rate-limit crisis like TextVerified's.
    """
    fx_rate = get_usd_to_ngn_rate()

    now = time.time()
    if _bloom_cache["data"] is not None and (now - _bloom_cache["fetched_at"]) < _BLOOM_CACHE_TTL_SECONDS:
        rows = _bloom_cache["data"]
    else:
        try:
            rows = bloom_list_services()
            _bloom_cache["data"] = rows
            _bloom_cache["fetched_at"] = now
        except BloomSMSError as e:
            logger.error("BloomSMS error while listing services: %s", e.message)
            # Same graceful-degradation pattern as the other providers --
            # serve a stale cache if we have one rather than erroring out.
            if _bloom_cache["data"] is not None:
                rows = _bloom_cache["data"]
            else:
                raise HTTPException(status_code=502, detail=f"BloomSMS error: {e.message}")

    out = []
    for row in rows:
        code = row.get("code")
        name = row.get("name") or code
        price = row.get("price")
        if code is None or price is None:
            logger.warning("Skipping unrecognized BloomSMS service row: %r", row)
            continue

        out.append(
            _build_service_out(
                provider="bloomsms",
                api_name=code,
                display_name=name,
                base_cents=_to_cents(price),
                fx_rate=fx_rate,
                stock=int(row.get("stock") or 0),
                multiple_sms=False,
            )
        )
    return out
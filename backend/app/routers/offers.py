"""
Unified offers: one search across ALL providers, grouped by service.

Why this exists: customers used to visit three separate pages (one per
provider) to compare prices. This router asks every provider for its
catalog, groups rows that are the same service (WhatsApp from provider 1,
WhatsApp from provider 2, ...) and returns them cheapest-first so the
frontend can pre-select the cheapest offer.

This router ONLY READS. It never rents, charges or refunds anything --
renting still goes through the existing, tested endpoints
(/rentals/rent, /verifications/rent, /activations/rent). Each offer
carries a `route` key ("s1" | "s2" | "s3") so the frontend knows which
one to call. Customers never see real provider names; the route key is an
opaque internal id.
"""
import logging
import re
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app import models, schemas
from app.deps import get_current_user
from app.routers import services as svc

router = APIRouter(prefix="/offers", tags=["offers"])

logger = logging.getLogger("uvicorn.error")

# BloomSMS's own default country id (United States).
US_COUNTRY = "187"

# Routes whose numbers are US-only (Getatext and Fetch SMS sell US numbers,
# which is why they take area codes / carriers rather than a country).
# They are only offered when the customer has US selected. BloomSMS ("s3")
# is the only provider that sells other countries. Edit this set if a
# provider's coverage changes.
US_ONLY_ROUTES = {"s1", "s2"}

# Matching the same service across providers is done on a normalized
# display name ("WhatsApp" == "whatsapp" == "Whats App"). When two
# providers spell a service differently, add an alias here:
#     normalized variant -> normalized canonical name
# e.g. SERVICE_ALIASES = {"googlegmail": "google", "wa": "whatsapp"}
SERVICE_ALIASES: dict[str, str] = {}

_GETATEXT_CACHE_TTL_SECONDS = 300
_getatext_cache = {"data": None, "fetched_at": 0.0}


class OfferOut(BaseModel):
    route: str            # "s1" | "s2" | "s3" -> which rent endpoint to call
    api_name: str         # the service id to send to that rent endpoint
    price_naira: float    # customer price (markup included)
    stock: int
    needs_country: bool   # True when this offer is tied to the chosen country


class OfferGroupOut(BaseModel):
    key: str
    display_name: str
    total_stock: int
    min_price_naira: Optional[float]   # cheapest IN-STOCK price, if any
    offers: list[OfferOut]             # in-stock cheapest-first, then out-of-stock


class OffersResponse(BaseModel):
    groups: list[OfferGroupOut]
    degraded: bool  # True when at least one provider could not be reached


def _norm(name: Optional[str]) -> str:
    key = re.sub(r"[^a-z0-9]", "", (name or "").lower())
    return SERVICE_ALIASES.get(key, key)


def _getatext_rows(user: models.User) -> list[schemas.ServiceOut]:
    now = time.time()
    if (
        _getatext_cache["data"] is not None
        and (now - _getatext_cache["fetched_at"]) < _GETATEXT_CACHE_TTL_SECONDS
    ):
        return _getatext_cache["data"]
    try:
        rows = svc.list_services(current_user=user)
    except HTTPException:
        # Serve stale data rather than nothing if we have any.
        if _getatext_cache["data"] is not None:
            return _getatext_cache["data"]
        raise
    _getatext_cache["data"] = rows
    _getatext_cache["fetched_at"] = now
    return rows


def _collect(user: models.User, country: str) -> tuple[list[tuple[str, schemas.ServiceOut]], bool]:
    """Returns ([(route, ServiceOut), ...], degraded). One provider failing
    must never hide the others, so each is fetched independently."""
    rows: list[tuple[str, schemas.ServiceOut]] = []
    degraded = False

    sources = []
    if country == US_COUNTRY:
        sources.append(("s1", lambda: _getatext_rows(user)))
        sources.append(("s2", lambda: svc.list_fetchsms_services(current_user=user)))
    sources.append(("s3", lambda: svc.list_bloomsms_services(country=country, current_user=user)))

    for route, fetch in sources:
        try:
            for row in fetch():
                rows.append((route, row))
        except HTTPException as e:
            degraded = True
            logger.warning("Offers: provider %s unavailable: %s", route, e.detail)
        except Exception:  # never let one provider take the page down
            degraded = True
            logger.exception("Offers: provider %s failed unexpectedly", route)
    return rows, degraded


def _build_groups(rows: list[tuple[str, schemas.ServiceOut]]) -> list[OfferGroupOut]:
    buckets: dict[str, dict] = {}
    for route, row in rows:
        key = _norm(row.display_name) or _norm(row.api_name)
        if not key:
            continue
        bucket = buckets.setdefault(key, {"name": row.display_name or row.api_name, "offers": []})
        bucket["offers"].append(
            OfferOut(
                route=route,
                api_name=row.api_name,
                price_naira=row.customer_price_naira,
                stock=row.stock,
                needs_country=route not in US_ONLY_ROUTES,
            )
        )

    groups = []
    for key, b in buckets.items():
        in_stock = sorted((o for o in b["offers"] if o.stock > 0), key=lambda o: o.price_naira)
        out_of_stock = sorted((o for o in b["offers"] if o.stock <= 0), key=lambda o: o.price_naira)
        groups.append(
            OfferGroupOut(
                key=key,
                display_name=b["name"],
                total_stock=sum(max(o.stock, 0) for o in b["offers"]),
                min_price_naira=in_stock[0].price_naira if in_stock else None,
                offers=in_stock + out_of_stock,
            )
        )
    return groups


@router.get("", response_model=OffersResponse)
def search_offers(
    q: Optional[str] = Query(None, max_length=60),
    country: str = US_COUNTRY,
    limit: int = Query(8, ge=1, le=50),
    current_user: models.User = Depends(get_current_user),
):
    """
    No `q`: the most popular services right now (most numbers in stock,
    out-of-stock ones hidden). With `q`: every service whose name matches,
    including out-of-stock ones so nothing is unreachable.
    """
    if not country.isdigit():
        raise HTTPException(status_code=422, detail="Invalid country")

    rows, degraded = _collect(current_user, country)
    if not rows and degraded:
        raise HTTPException(status_code=502, detail="Services are unavailable right now. Please try again.")

    groups = _build_groups(rows)

    query = _norm(q) if q else ""
    if query:
        groups = [g for g in groups if query in g.key]
        groups.sort(key=lambda g: (not g.key.startswith(query), -g.total_stock, g.display_name.lower()))
    else:
        groups = [g for g in groups if g.min_price_naira is not None]
        groups.sort(key=lambda g: (-g.total_stock, g.display_name.lower()))

    return OffersResponse(groups=groups[:limit], degraded=degraded)

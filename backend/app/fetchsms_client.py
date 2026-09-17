"""
app/fetchsms_client.py

Wrapper around the Fetch SMS API (https://fetchsms.com/docs/api).

UNLIKE textverified_client.py, Fetch SMS is a plain, clearly-documented
REST API over HTTPS with published request/response shapes -- so this is
a direct httpx wrapper (same style as getatext_client.py), not a
defensive best-effort layer probing for unknown attribute names.

One real behavioral difference from Getatext/TextVerified worth noting:
Fetch SMS's POST /v1/verifications does NOT accept a max_price /
price-ceiling parameter -- only `service` and an optional `area_code`.
So the protective "don't spend more than the customer authorized" check
that Getatext/TextVerified enforce server-side has to happen HERE,
client-side, before we ever call create: quote the price first via
GET /v1/services/quote, and refuse up front if it would exceed max_price.
This mirrors the same intent as the other two providers' max_price
behavior, just implemented at a different layer since the API doesn't
give us the hook to do it their way.

Auth: Authorization: Bearer <FETCHSMS_API_KEY> on every authenticated
call. GET /v1/services and GET /v1/services/quote are public and don't
require a key at all.
"""

import logging
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger("uvicorn.error")

BASE_URL = "https://api.fetchsms.com/v1"


class FetchSMSClientError(Exception):
    """Raised when Fetch SMS returns an error or we can't parse its response."""

    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


_client: Optional[httpx.Client] = None  # lazily-created singleton, same pattern as textverified_client.py


def _get_client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(
            base_url=BASE_URL,
            headers={"Authorization": f"Bearer {settings.FETCHSMS_API_KEY}"},
            timeout=20.0,
        )
    return _client


def _request(method: str, path: str, **kwargs) -> dict:
    """
    Single guarded entry point for every Fetch SMS call. Translates HTTP
    errors into FetchSMSClientError using their documented {"detail": "..."}
    error body, preserving the real status code (their docs define a
    specific meaning per code -- 402 insufficient balance, 409 out of
    stock/already received, 422 bad duration, etc.) so the router can
    react appropriately instead of everything collapsing to a generic 502.
    """
    client = _get_client()
    try:
        resp = client.request(method, path, **kwargs)
    except httpx.RequestError as e:
        raise FetchSMSClientError(f"Fetch SMS request failed: {e}", 502) from e

    if resp.status_code >= 400:
        try:
            detail = resp.json().get("detail", resp.text)
        except Exception:
            detail = resp.text or f"HTTP {resp.status_code}"
        raise FetchSMSClientError(detail, resp.status_code)

    if not resp.content:
        return {}
    return resp.json()


# --- Services / catalog -------------------------------------------------

def list_services() -> list[dict]:
    """
    Returns a normalized list of dicts: [{"api_name", "display_name",
    "base_price_usd", "short_available", "long_available"}], same shape
    contract as the other two clients' list_services(). Uses the stable
    numeric `id` (as a string) for api_name, since Fetch SMS's own docs
    recommend id over slug as the reference to pass back on every other
    endpoint.
    """
    data = _request("GET", "/services")
    return [
        {
            "api_name": str(item["id"]),
            "display_name": item["name"],
            "base_price_usd": item["price_cents"] / 100,
            "short_available": item.get("short_available", 0),
            "long_available": item.get("long_available", 0),
        }
        for item in data
    ]


def get_price_quote(
    service: str, mode: str = "short", days: Optional[int] = None, custom_area_code: bool = False
) -> dict:
    """
    Calls GET /v1/services/quote. Returns the raw quote dict, notably
    total_cents -- the exact price to be charged before committing to a
    purchase. No auth required (public endpoint per their docs).
    """
    params = {"service": service, "mode": mode, "custom_area_code": str(custom_area_code).lower()}
    if days is not None:
        params["days"] = days
    return _request("GET", "/services/quote", params=params)


# --- Verifications (short-term) -----------------------------------------

def create_verification(
    service: str, area_code: Optional[str] = None, max_price: Optional[float] = None
) -> dict:
    """
    Creates a short-term verification. Returns a normalized dict:
    {"id", "number", "cost"} -- same shape as textverified_client.py's
    create_verification(), so verifications.py's router doesn't need to
    know which provider it's talking to.

    max_price is enforced HERE, not by Fetch SMS's API (see module
    docstring) -- if provided, quotes the price first and raises
    FetchSMSClientError(400) before ever creating the verification (and
    therefore before any charge) if the quoted total would exceed it.
    """
    if max_price is not None:
        quote = get_price_quote(service, mode="short", custom_area_code=bool(area_code))
        quoted_usd = quote["total_cents"] / 100
        if quoted_usd > max_price:
            raise FetchSMSClientError(
                f"Fetch SMS price (${quoted_usd:.2f}) exceeds the authorized "
                f"maximum (${max_price:.2f})",
                400,
            )

    body = {"service": service}
    if area_code:
        body["area_code"] = area_code

    data = _request("POST", "/verifications", json=body)

    return {
        "id": data["id"],
        "number": data["number"],
        "cost": data["cost_cents"] / 100,
    }


def get_sms_code(verification_id: str) -> Optional[str]:
    """
    Polls for the SMS code on a verification. Returns None if nothing has
    arrived yet -- matches the poll semantics used identically by
    getatext_client.py and textverified_client.py (frontend polls every
    5s via the router).
    """
    data = _request("GET", f"/verifications/{verification_id}")
    return data.get("code")


def cancel_verification(verification_id: str) -> bool:
    """
    Cancels a waiting verification (refunds Fetch SMS's own charge on
    their side). Raises FetchSMSClientError(409) if a code has already
    arrived -- per their docs, POST /cancel returns 409 once a code is
    in, which the caller should treat as "too late to cancel", same as
    the other two providers' cancel-after-code-received behavior.
    """
    _request("POST", f"/verifications/{verification_id}/cancel")
    return True


# --- Wallet ---------------------------------------------------------------

def get_wallet_balance_cents() -> int:
    """
    Fetch SMS's OWN prepaid balance on their platform (not this app's
    customer wallets) -- useful for an admin/ops check of how much
    runway is left with this provider, same idea as however
    getatext_client.py surfaces its own balance, if it does.
    """
    data = _request("GET", "/wallet/balance")
    return data["balance_cents"]

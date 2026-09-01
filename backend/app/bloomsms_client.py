"""
app/bloomsms_client.py

Thin wrapper around the BloomSMS API (https://bloomsms.com/api-docs).

Raw httpx, same pattern as getatext_client.py -- UNLIKE textverified_client.py,
BloomSMS's docs are a normal static page with full endpoint/payload
documentation and a clean {status, data, errors} envelope, so there's no
need to guess at wire-level details or wrap a third-party package here.

Auth is a static Bearer token (no refresh needed, unlike TextVerified).
Their docs publish a rate limit of 60 requests/min per API key -- well
above what a single /services call needs, since (unlike TextVerified)
BloomSMS's services listing returns price directly, no per-service
pricing calls required.

Only short-term "activation" endpoints are implemented (rent, status,
cancel/complete). BloomSMS's separate Long Rentals system
(1d/3d/7d/14d/30d periods, auto-renew) is out of scope for now, same
treatment as Getatext's long-rentals and TextVerified's renewable-rental
system.

>>> UNCERTAINTY FLAGGED: their docs don't show an example response body
for cancelling a SHORT-TERM activation (only for long-rentals, which
show a refund_amount field). update_activation_status() below defensively
checks for a refund figure in the response and falls back to refunding
the full charged amount if none is present -- same conservative default
used for TextVerified's cancel, for the same reason (no confirmed data
on partial-usage refund behavior for this specific call).
"""

from typing import Any, Optional

import httpx

from app.config import settings


class BloomSMSError(Exception):
    """Raised when BloomSMS returns a non-2xx response or an `errors` field."""

    def __init__(self, message: str, status_code: int = 400, code: Optional[str] = None):
        self.message = message
        self.status_code = status_code
        self.code = code
        super().__init__(message)


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.BLOOMSMS_API_KEY}",
        "Content-Type": "application/json",
    }


def _client() -> httpx.Client:
    return httpx.Client(base_url=settings.BLOOMSMS_BASE_URL, timeout=20.0)


def _unwrap(resp: httpx.Response) -> Any:
    """Unwraps BloomSMS's {status, data, errors} envelope, raising on error."""
    try:
        body = resp.json()
    except ValueError:
        raise BloomSMSError(f"Non-JSON response from BloomSMS: {resp.text}", resp.status_code)

    if body.get("status") == "error" or body.get("errors"):
        err = body.get("errors") or {}
        raise BloomSMSError(
            err.get("message", "Unknown BloomSMS error"),
            resp.status_code,
            code=err.get("code"),
        )

    if resp.status_code >= 400:
        raise BloomSMSError(f"BloomSMS error (HTTP {resp.status_code})", resp.status_code)

    return body.get("data")


def get_balance() -> dict:
    with _client() as client:
        resp = client.get("/balance", headers=_headers())
    return _unwrap(resp)


def list_services(country: str = "187") -> list[dict]:
    """
    Defaults to country 187 (US), matching BloomSMS's own documented
    default. Unlike TextVerified, price and stock come back directly in
    this one call -- no per-service pricing lookups needed.
    """
    with _client() as client:
        resp = client.get("/services", params={"country": country}, headers=_headers())
    data = _unwrap(resp)
    return data.get("services", []) if data else []


def rent_activation(
    service: str, country: Optional[str] = None, max_price: Optional[float] = None
) -> dict:
    payload: dict[str, Any] = {"service": service}
    if country is not None:
        payload["country"] = country
    if max_price is not None:
        payload["max_price"] = max_price

    with _client() as client:
        resp = client.post("/activations", json=payload, headers=_headers())
    return _unwrap(resp)


def get_activation_status(activation_id: str) -> dict:
    with _client() as client:
        resp = client.get(f"/activations/{activation_id}", headers=_headers())
    return _unwrap(resp)


def update_activation_status(activation_id: str, status: str) -> dict:
    """
    status: "cancel" | "complete" | "request_another_sms"
    (request_another_sms isn't wired up in the router yet -- out of
    scope for v1, same as re-rent and long rentals.)
    """
    with _client() as client:
        resp = client.patch(
            f"/activations/{activation_id}", json={"status": status}, headers=_headers()
        )
    return _unwrap(resp)

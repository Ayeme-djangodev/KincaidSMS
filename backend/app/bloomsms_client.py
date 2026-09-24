"""
app/bloomsms_client.py

Thin wrapper around the BloomSMS API (https://bloomsms.com/api-docs).

Raw httpx, same pattern as getatext_client.py. BloomSMS's docs have full
endpoint/payload documentation and a clean {status, data, errors} envelope.

Auth is a static Bearer token. Documented rate limit: 60 requests/min per
API key.

Only short-term "activation" endpoints are implemented (rent, status,
cancel/complete). Long Rentals are out of scope for now.

>>> UNCERTAINTY FLAGGED: their docs don't show an example response body
for cancelling a SHORT-TERM activation (only for long-rentals, which
show a refund_amount field). update_activation_status() returns the
response as-is; the caller should check for a refund figure and fall back
to refunding the full charged amount if none is present.

CHANGES IN THIS VERSION
- Added list_countries() (the frontend calls /services/bloomsms/countries
  but the client had no way to fetch them). Output is normalised to
  {"code", "name"} because BloomSMS returns {"id", "name"}.
- Network failures (timeouts, DNS, connection refused) are now converted
  into BloomSMSError(502) instead of bubbling up as raw httpx exceptions,
  which surfaced as opaque 500s.
- _unwrap() no longer crashes if the body is valid JSON but not an object.
- Money-spending calls are never retried automatically (no idempotency key
  is documented, so a retry after a timeout could double-charge).
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
    # BLOOMSMS_BASE_URL must be https://bloomsms.com/api/v1 (no trailing
    # path segments, no /api-docs). httpx keeps the base path when joining.
    return httpx.Client(base_url=settings.BLOOMSMS_BASE_URL, timeout=20.0)


def _request(method: str, path: str, **kwargs) -> Any:
    """Send a request and unwrap the envelope; map transport errors."""
    try:
        with _client() as client:
            resp = client.request(method, path, headers=_headers(), **kwargs)
    except httpx.TimeoutException:
        raise BloomSMSError("BloomSMS request timed out", 504, code="TIMEOUT")
    except httpx.RequestError as exc:
        raise BloomSMSError(f"Could not reach BloomSMS: {exc}", 502, code="UNREACHABLE")
    return _unwrap(resp)


def _unwrap(resp: httpx.Response) -> Any:
    """Unwraps BloomSMS's {status, data, errors} envelope, raising on error."""
    try:
        body = resp.json()
    except ValueError:
        raise BloomSMSError(
            f"Non-JSON response from BloomSMS (HTTP {resp.status_code})", resp.status_code
        )

    if not isinstance(body, dict):
        raise BloomSMSError("Unexpected response shape from BloomSMS", resp.status_code)

    if body.get("status") == "error" or body.get("errors"):
        err = body.get("errors") or {}
        if not isinstance(err, dict):
            err = {"message": str(err)}
        raise BloomSMSError(
            err.get("message", "Unknown BloomSMS error"),
            resp.status_code,
            code=err.get("code"),
        )

    if resp.status_code >= 400:
        raise BloomSMSError(f"BloomSMS error (HTTP {resp.status_code})", resp.status_code)

    return body.get("data")


def get_balance() -> dict:
    return _request("GET", "/balance")


def list_countries() -> list[dict]:
    """
    Returns [{"code": "187", "name": "United States"}, ...].
    BloomSMS calls the field `id`; we expose it as `code` to match the
    frontend. If your router already remaps this, drop the remap here.
    """
    data = _request("GET", "/countries")
    raw = (data or {}).get("countries", [])
    return [
        {"code": str(c.get("code", c.get("id"))), "name": c.get("name", "")}
        for c in raw
        if c.get("code", c.get("id")) is not None
    ]


def list_services(country: str = "187") -> list[dict]:
    """
    Defaults to country 187 (US), matching BloomSMS's own documented
    default. Price and stock come back directly in this one call.
    """
    data = _request("GET", "/services", params={"country": country})
    return (data or {}).get("services", [])


def rent_activation(
    service: str, country: Optional[str] = None, max_price: Optional[float] = None
) -> dict:
    """Spends money. Do NOT auto-retry on timeout/502 -- check balance first."""
    payload: dict[str, Any] = {"service": service}
    if country:
        payload["country"] = country
    if max_price is not None:
        payload["max_price"] = max_price
    return _request("POST", "/activations", json=payload)


def get_activation_status(activation_id: str) -> dict:
    return _request("GET", f"/activations/{activation_id}")


def update_activation_status(activation_id: str, status: str) -> dict:
    """
    status: "cancel" | "complete" | "request_another_sms"
    (request_another_sms isn't wired up in the router yet.)
    """
    if status not in {"cancel", "complete", "request_another_sms"}:
        raise BloomSMSError(f"Invalid status: {status}", 422, code="INVALID_PARAMETER")
    return _request("PATCH", f"/activations/{activation_id}", json={"status": status})

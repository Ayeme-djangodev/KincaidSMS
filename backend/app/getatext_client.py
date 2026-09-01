"""
Thin wrapper around the Getatext API (https://getatext.com/api-docs).

Only the endpoints this reseller app currently uses are implemented:
- POST /api/v1/rent-a-number
- POST /api/v1/rent-specific-number
- POST /api/v1/cancel-rental
- POST /api/v1/rental-status
- POST /api/v1/rental-status/{id}/completed
- GET  /api/v1/prices-info
- GET  /api/v1/balance

The real Getatext API key lives only here, on the server. It is never sent
to the frontend.
"""

from typing import Any, Optional

import httpx

from app.config import settings


class GetatextError(Exception):
    """Raised when Getatext returns a non-2xx response or an `errors` field."""

    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def _headers() -> dict:
    return {
        "Auth": settings.GETATEXT_API_KEY,
        "Content-Type": "application/json",
    }


def _client() -> httpx.Client:
    return httpx.Client(base_url=settings.GETATEXT_BASE_URL, timeout=20.0)


def _raise_for_errors(resp: httpx.Response) -> dict:
    try:
        data = resp.json()
    except ValueError:
        raise GetatextError(f"Non-JSON response from Getatext: {resp.text}", resp.status_code)

    errors = data.get("errors")
    if errors:
        raise GetatextError(str(errors), resp.status_code)

    if resp.status_code >= 400:
        raise GetatextError(f"Getatext error (HTTP {resp.status_code})", resp.status_code)

    return data


def rent_a_number(
    service: str,
    max_price: Optional[float] = None,
    carrier: Optional[str] = None,
    keep_carrier: Optional[bool] = None,
    lock_area_code: Optional[bool] = None,
    area_codes: Optional[str] = None,
) -> dict:
    payload: dict[str, Any] = {"service": service}
    if max_price is not None:
        payload["max_price"] = max_price
    if carrier is not None:
        payload["carrier"] = carrier
    if keep_carrier is not None:
        payload["keep_carrier"] = keep_carrier
    if lock_area_code is not None:
        payload["lock_area_code"] = lock_area_code
    if area_codes is not None:
        payload["area_codes"] = area_codes

    with _client() as client:
        resp = client.post("/api/v1/rent-a-number", json=payload, headers=_headers())
    return _raise_for_errors(resp)


def rent_specific_number(number: str, service: str, max_price: Optional[float] = None) -> dict:
    payload: dict[str, Any] = {"number": number, "service": service}
    if max_price is not None:
        payload["max_price"] = max_price

    with _client() as client:
        resp = client.post("/api/v1/rent-specific-number", json=payload, headers=_headers())
    return _raise_for_errors(resp)


def cancel_rental(rental_id: int) -> dict:
    with _client() as client:
        resp = client.post(
            "/api/v1/cancel-rental", json={"id": rental_id}, headers=_headers()
        )
    return _raise_for_errors(resp)


def rental_status(rental_id: int) -> dict:
    with _client() as client:
        resp = client.post(
            "/api/v1/rental-status", json={"id": rental_id}, headers=_headers()
        )
    return _raise_for_errors(resp)


def mark_completed(rental_id: int) -> dict:
    with _client() as client:
        resp = client.post(
            f"/api/v1/rental-status/{rental_id}/completed", headers=_headers()
        )
    return _raise_for_errors(resp)


def prices_info() -> Any:
    with _client() as client:
        resp = client.get("/api/v1/prices-info", headers=_headers())
    return _raise_for_errors(resp)


def get_balance() -> dict:
    with _client() as client:
        resp = client.get("/api/v1/balance", headers=_headers())
    return _raise_for_errors(resp)

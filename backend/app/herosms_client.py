"""
app/herosms_client.py

Thin wrapper around HeroSMS (https://hero-sms.com/api), using its
SMS-Activate-compatible endpoint:

    GET https://hero-sms.com/stubs/handler_api.php?action=...&api_key=...

Why this endpoint and not /api/v1: it covers everything a short-term
activation needs (price list, buy, status, cancel, finish) with plain
query-string calls, and it is the same protocol many resellers already run.

Quirks to know about (from the HeroSMS spec):
- Most replies are PLAIN TEXT, not JSON: "ACCESS_BALANCE:100.5",
  "STATUS_OK:123456", "NO_NUMBERS", ... Errors usually come back as HTTP
  200 with an error word as the body, so the body must be inspected.
- getNumberV2 is the one JSON success reply (activationId, phoneNumber,
  activationCost, activationEndTime, ...).
- Prices are USD (currency 840 is the default), which is what our wallet
  ledger already uses.
- A number cannot be cancelled in its first 2 minutes (EARLY_CANCEL_DENIED).
- There is no documented push webhook, so codes are fetched by polling
  getStatus. Rate limits are not published for this endpoint; callers must
  keep poll frequency modest and treat HTTP 429 as "try again later".

SECURITY: the key travels in the query string, so URLs must never be logged
or put into error messages. httpx's own request logging is silenced below
for the same reason.

Money-spending calls (getNumberV2) are never retried automatically: there
is no idempotency key, so a retry after a timeout could double-charge.
"""

import json
import logging
from typing import Any, Optional

import httpx

from app.config import settings

# httpx logs full request URLs at INFO, which would include api_key.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

logger = logging.getLogger("uvicorn.error")


class HeroSMSError(Exception):
    """Raised when HeroSMS returns an error word, a bad status, or is unreachable."""

    def __init__(self, message: str, status_code: int = 400, code: Optional[str] = None):
        self.message = message
        self.status_code = status_code
        self.code = code
        super().__init__(message)


# provider error word -> (HTTP status for our API, customer-safe message)
# Anything about OUR account with the provider (key, float, ban) is hidden
# from customers behind a generic message; the real code is logged.
_ERRORS: dict[str, tuple[int, str]] = {
    "NO_NUMBERS": (409, "No numbers are available for this option right now. Please try another option."),
    "WRONG_MAX_PRICE": (409, "The price just changed. Please refresh and try again."),
    "EARLY_CANCEL_DENIED": (400, "This number can only be cancelled after 2 minutes. Please wait a little and try again."),
    "NO_ACTIVATION": (404, "Activation not found."),
    "WRONG_ACTIVATION_ID": (404, "Activation not found."),
    "BAD_SERVICE": (422, "This service is not available."),
    "BAD_COUNTRY": (422, "This country is not available."),
    "NO_BALANCE": (502, "This option is temporarily unavailable. Please try another option."),
    "BAD_KEY": (502, "This option is temporarily unavailable. Please try another option."),
    "BANNED": (502, "This option is temporarily unavailable. Please try another option."),
    "ACCOUNT_INACTIVE": (502, "This option is temporarily unavailable. Please try another option."),
    "CHANNELS_LIMIT": (429, "Too many requests right now. Please try again in a moment."),
    "BAD_ACTION": (502, "This option is temporarily unavailable. Please try another option."),
    "BAD_STATUS": (502, "This option is temporarily unavailable. Please try another option."),
    "ERROR_SQL": (502, "This option is temporarily unavailable. Please try another option."),
}
_GENERIC = (502, "This option is temporarily unavailable. Please try again.")


def _fail(word: str) -> HeroSMSError:
    """Map an error word like 'WRONG_MAX_PRICE:0.025' to a HeroSMSError."""
    code = word.split(":", 1)[0].strip()
    status, message = _ERRORS.get(code, _GENERIC)
    if status >= 500 or code not in _ERRORS:
        logger.error("HeroSMS returned %r", word[:200])
    return HeroSMSError(message, status, code=code)


def _request_text(action: str, **params) -> str:
    if not settings.HEROSMS_API_KEY:
        logger.error("HEROSMS_API_KEY is not set")
        raise HeroSMSError("This option is temporarily unavailable. Please try again.", 502, code="NO_KEY")

    query = {"action": action, "api_key": settings.HEROSMS_API_KEY}
    query.update({k: v for k, v in params.items() if v is not None})
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.get(settings.HEROSMS_BASE_URL, params=query)
    except httpx.TimeoutException:
        raise HeroSMSError("The provider timed out. Please try again.", 504, code="TIMEOUT")
    except httpx.RequestError as exc:
        # type name only: str(exc) can contain the URL (and so the key)
        logger.error("Could not reach HeroSMS (%s)", type(exc).__name__)
        raise HeroSMSError("Could not reach the provider. Please try again.", 502, code="UNREACHABLE")

    if resp.status_code == 429:
        raise HeroSMSError("Too many requests right now. Please try again in a moment.", 429, code="RATE_LIMITED")
    if resp.status_code >= 500:
        logger.error("HeroSMS HTTP %s for action=%s", resp.status_code, action)
        raise HeroSMSError(_GENERIC[1], 502, code=f"HTTP_{resp.status_code}")
    if resp.status_code in (401, 403):
        logger.error("HeroSMS HTTP %s for action=%s (check HEROSMS_API_KEY)", resp.status_code, action)
        raise HeroSMSError(_GENERIC[1], 502, code="AUTH")

    return resp.text.strip()


def _maybe_json(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return None


def get_balance() -> float:
    text = _request_text("getBalance")
    if text.startswith("ACCESS_BALANCE:"):
        return float(text.split(":", 1)[1])
    raise _fail(text)


def list_countries() -> list[dict]:
    """Returns [{"code": "187", "name": "USA"}, ...] for visible countries."""
    text = _request_text("getCountries")
    data = _maybe_json(text)
    if data is None:
        raise _fail(text)
    if isinstance(data, dict):
        data = list(data.values())
    out = []
    for c in data if isinstance(data, list) else []:
        if not isinstance(c, dict) or c.get("id") is None:
            continue
        if c.get("visible") == 0:
            continue
        out.append({"code": str(c["id"]), "name": c.get("eng") or c.get("name") or str(c["id"])})
    return out


def list_service_names() -> dict[str, str]:
    """{service code: display name}."""
    text = _request_text("getServicesList")
    data = _maybe_json(text)
    if data is None:
        raise _fail(text)
    rows = data.get("services", []) if isinstance(data, dict) else data
    return {
        str(r["code"]): r.get("name") or str(r["code"])
        for r in rows
        if isinstance(r, dict) and r.get("code")
    }


def list_prices(country: str) -> list[dict]:
    """
    One call, all services for one country: [{"code", "price", "stock"}].
    getPrices is marked deprecated in the spec (replacement:
    /activations/offers/{type}); it is used because its shape is simple and
    documented. The parser accepts the documented shapes
    ({country:{service:{cost,count}}}, {service:{...}}, or a list of those).
    """
    text = _request_text("getPrices", country=country)
    data = _maybe_json(text)
    if data is None:
        raise _fail(text)

    merged: dict[str, dict] = {}

    def absorb(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                absorb(item)
            return
        if not isinstance(node, dict):
            return
        for key, val in node.items():
            if not isinstance(val, dict):
                continue
            if "cost" in val or "price" in val:
                merged[str(key)] = val
            elif str(key) == str(country):
                absorb(val)
            else:
                # unknown wrapper level (e.g. {"187": {...}} for another id)
                if all(isinstance(v, dict) for v in val.values()):
                    absorb(val)

    absorb(data)

    out = []
    for code, val in merged.items():
        price = val.get("cost", val.get("price"))
        if price is None:
            continue
        try:
            out.append({"code": code, "price": float(price), "stock": int(val.get("count") or 0)})
        except (TypeError, ValueError):
            logger.warning("Skipping unrecognized HeroSMS price row for %r", code)
    return out


def get_number(service: str, country: str, max_price: Optional[float] = None) -> dict:
    """
    Buys a number (getNumberV2). Spends money: do NOT auto-retry.
    Returns {"activation_id", "phone_number", "price", "expires_at"}.
    """
    text = _request_text(
        "getNumberV2",
        service=service,
        country=country,
        maxPrice=(f"{max_price:.4f}".rstrip("0").rstrip(".") if max_price is not None else None),
    )
    data = _maybe_json(text)
    if isinstance(data, dict) and data.get("activationId") is not None:
        phone = str(data.get("phoneNumber") or "")
        if phone and not phone.startswith("+"):
            phone = "+" + phone
        return {
            "activation_id": str(data["activationId"]),
            "phone_number": phone or None,
            "price": float(data.get("activationCost") or 0),
            "expires_at": data.get("activationEndTime"),
        }

    # Error as JSON ({"title": "WRONG_MAX_PRICE", ...}) or as a plain word.
    if isinstance(data, dict) and data.get("title"):
        raise _fail(str(data["title"]))
    raise _fail(text)


def get_status(activation_id: str) -> dict:
    """
    Returns {"state": "waiting" | "code_received" | "cancelled", "code": str | None}.

    getStatus replies (plain text):
      STATUS_WAIT_CODE          waiting for the SMS
      STATUS_WAIT_RETRY:<last>  waiting for a corrected code
      STATUS_WAIT_RESEND        waiting for SMS to be resent
      STATUS_OK:<code>          code received
      STATUS_CANCEL             activation cancelled/expired (provider refunds us)
    """
    text = _request_text("getStatus", id=activation_id)
    if text.startswith("STATUS_OK"):
        code = text.split(":", 1)[1].strip() if ":" in text else ""
        return {"state": "code_received", "code": code or None}
    if text.startswith("STATUS_CANCEL"):
        return {"state": "cancelled", "code": None}
    if text.startswith("STATUS_WAIT"):
        return {"state": "waiting", "code": None}
    raise _fail(text)


def set_status(activation_id: str, status: int) -> str:
    """status: 6 = finish (code used), 8 = cancel (refund). Returns the reply word."""
    if status not in (3, 6, 8):
        raise HeroSMSError(f"Invalid status: {status}", 422, code="BAD_STATUS")
    text = _request_text("setStatus", id=activation_id, status=status)
    expected = {3: "ACCESS_RETRY_GET", 6: "ACCESS_ACTIVATION", 8: "ACCESS_CANCEL"}[status]
    if text.startswith(expected):
        return expected
    raise _fail(text)

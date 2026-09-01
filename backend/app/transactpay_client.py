"""
app/transactpay_client.py

Thin wrapper around TransactPay's payment API
(https://transactpay.readme.io/), used to replace the wallet deposit
stub with real payment processing.

INTEGRATION MODEL: TransactPay's recommended path is the "Standard Kit"
-- a client-side JS widget (script tag + PaymentCheckout config) that
handles the actual checkout UI and creates the order itself using your
PUBLIC key + PUBLIC encryption key. This module does NOT create orders
server-side for that reason -- the widget config bundle is built by the
/wallet/deposit/initiate endpoint (in wallet.py) and handed to the
frontend, which launches the widget directly.

What THIS module does is the part that has to happen server-side: verify
a deposit really succeeded before crediting the wallet. Their own docs
say this explicitly: "Always verify the transaction on your server after
success using our Verify Transaction API."

CONFIRMED FROM A REAL TEST CALL: POST /payment/order/status requires the
request body to be RSA-encrypted, wrapped as {"data": "<encrypted>"}  --
a plain {"reference": ...} body gets rejected with "Unable to find the
encrypted data, please encrypt your payload and try again". This module
now encrypts every request to this endpoint. The encryption details below
are also confirmed from TransactPay's own Card Payments docs (their
Node.js example, which uses node-forge):

  - Padding: RSA PKCS#1 v1.5 (their docs say this explicitly -- not the
    more modern OAEP)
  - Key format: TRANSACTPAY_ENCRYPTION_KEY is a base64-encoded string
    containing a "{keysize}!" prefix followed by an XML RSA public key,
    e.g. base64(
      "4096!<RSAKeyValue><Modulus>...</Modulus><Exponent>...</Exponent></RSAKeyValue>"
    ) -- CONFIRMED against a real key from the TransactPay dashboard
    (the "4096" matched the actual parsed key's bit length exactly).
    NOT a standard PEM key. Parsed here manually via xml.etree + the
    `cryptography` package's RSAPublicNumbers.
  - Output: base64-encoded ciphertext, sent as {"data": "<ciphertext>"}

The encrypt-parse logic was verified against both a synthetic test
keypair AND a real key copied from the TransactPay dashboard before
being wired in here.

Requires the `cryptography` package: pip install cryptography --break-system-packages

>>> STILL UNCONFIRMED: their docs are internally inconsistent about which
key goes in the 'api-key' header for which endpoint (prose says secret
key as a Bearer token; every actual code example uses the public key in
an 'api-key' header). This module defaults to the PUBLIC key for the
status check, matching the pattern shown in their own working examples.
If verification calls fail with a 401, swapping to TRANSACTPAY_SECRET_KEY
is the first thing to try.
"""

import base64
import json
import logging
import xml.etree.ElementTree as ET
from typing import Any, Optional

import httpx
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
from cryptography.hazmat.primitives.asymmetric import rsa

from app.config import settings

logger = logging.getLogger("uvicorn.error")


class TransactPayError(Exception):
    """Raised when TransactPay returns an error or an unparseable response."""

    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def _headers(use_secret: bool = False) -> dict:
    key = settings.TRANSACTPAY_SECRET_KEY if use_secret else settings.TRANSACTPAY_PUBLIC_KEY
    return {
        "api-key": key,
        "Content-Type": "application/json",
        "accept": "application/json",
    }


def _client() -> httpx.Client:
    return httpx.Client(base_url=settings.TRANSACTPAY_BASE_URL, timeout=20.0)


_cached_public_key = None  # parsing the XML key is pure overhead to redo every call


def _get_encryption_public_key():
    """
    Parses settings.TRANSACTPAY_ENCRYPTION_KEY (base64-encoded XML RSA
    public key) into a usable RSA public key object. Cached after first
    parse since the key doesn't change at runtime.
    """
    global _cached_public_key
    if _cached_public_key is not None:
        return _cached_public_key

    try:
        decoded = base64.b64decode(settings.TRANSACTPAY_ENCRYPTION_KEY).decode("utf-8")

        # CONFIRMED FROM A REAL KEY: the decoded content isn't pure XML --
        # it has a "{keysize}!" prefix before the <RSAKeyValue> element,
        # e.g. "4096!<RSAKeyValue>...". Strip everything up to and
        # including the first "!" before parsing as XML.
        xml_str = decoded.split("!", 1)[1] if "!" in decoded else decoded

        root = ET.fromstring(xml_str)
        modulus_b64 = root.findtext("Modulus")
        exponent_b64 = root.findtext("Exponent")
        if not modulus_b64 or not exponent_b64:
            raise ValueError("XML key missing Modulus or Exponent element")

        n = int.from_bytes(base64.b64decode(modulus_b64), byteorder="big")
        e = int.from_bytes(base64.b64decode(exponent_b64), byteorder="big")

        _cached_public_key = rsa.RSAPublicNumbers(e, n).public_key()
        return _cached_public_key
    except Exception as exc:
        logger.error("Failed to parse TRANSACTPAY_ENCRYPTION_KEY as an XML RSA public key: %s", exc)
        raise TransactPayError(
            "Could not parse TRANSACTPAY_ENCRYPTION_KEY. Expected a base64-encoded XML RSA "
            "public key like base64('<RSAKeyValue><Modulus>...</Modulus><Exponent>...</Exponent></RSAKeyValue>'). "
            "Double-check the key copied from your TransactPay dashboard.",
            500,
        ) from exc


def _encrypt_payload(payload: dict) -> str:
    """
    Encrypts a JSON-serializable payload with TransactPay's public
    encryption key using RSA PKCS#1 v1.5 padding, returning base64.
    """
    public_key = _get_encryption_public_key()
    plaintext = json.dumps(payload).encode("utf-8")
    ciphertext = public_key.encrypt(plaintext, asym_padding.PKCS1v15())
    return base64.b64encode(ciphertext).decode("utf-8")


def verify_order(reference: str) -> dict:
    """
    Checks the current status of an order by reference, server-to-server.
    This is THE authoritative source of truth for whether a deposit
    succeeded -- never trust a webhook payload or a client-side
    onCompleted() callback's claimed status/amount without this call
    confirming it independently.

    CONFIRMED: this endpoint requires the RSA-encrypted payload wrapper
    (see module docstring). Returns the FULL raw response body (not
    unwrapped/stripped) -- a real successful response looks like:
      {"status": "Successful", "statusCode": "00", "message": "...",
       "data": {"orderSummary": {"status": "Successful", ...}, ...}}
    The top-level "status"/"statusCode" turned out to be the actual
    useful fields -- an earlier version of this function stripped them
    out via a generic _unwrap() helper before is_order_successful() ever
    saw them, which silently caused successful payments to be treated as
    not-yet-successful. Fixed by returning the raw body directly.
    """
    encrypted = _encrypt_payload({"reference": reference})

    with _client() as client:
        resp = client.post(
            "/payment/order/status",
            json={"data": encrypted},
            headers=_headers(use_secret=False),
        )

    logger.info("Raw TransactPay order/status response for %r: %r", reference, resp.text)

    try:
        return resp.json()
    except ValueError:
        raise TransactPayError(f"Non-JSON response from TransactPay: {resp.text}", resp.status_code)


def is_order_successful(status_payload: dict) -> bool:
    """
    Checks a verify_order() response for a successful status.

    CONFIRMED FROM A REAL SUCCESSFUL BANK-TRANSFER DEPOSIT:
      Top level: {"status": "Successful", "statusCode": "00", ...}
      Nested:    data.orderSummary.status == "Successful"
    "statusCode": "00" is the most reliable single check (very standard
    convention in Nigerian payment processing -- "00" universally means
    success). Falls back to the "status" strings (case-insensitive) at
    both the top level and nested orderSummary in case a different
    payment method (card, etc.) shapes the response slightly differently
    -- untested against those methods yet, only confirmed for
    bank-transfer so far.
    """
    if not isinstance(status_payload, dict):
        return False

    status_code = status_payload.get("statusCode")
    if status_code == "00":
        return True

    success_values = {"successful", "success", "completed", "paid", "approved"}

    top_status = status_payload.get("status")
    if isinstance(top_status, str) and top_status.strip().lower() in success_values:
        return True

    order_summary = (status_payload.get("data") or {}).get("orderSummary") or {}
    nested_status = order_summary.get("status")
    if isinstance(nested_status, str) and nested_status.strip().lower() in success_values:
        return True

    logger.info(
        "TransactPay order/status did not match known success indicators "
        "(top statusCode=%r, top status=%r, nested orderSummary.status=%r) -- "
        "treating as not-yet-successful.",
        status_code, top_status, nested_status,
    )
    return False

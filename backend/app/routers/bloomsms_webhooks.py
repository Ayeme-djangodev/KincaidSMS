"""
app/routers/bloomsms_webhooks.py

Receives BloomSMS webhook events (configured at
https://bloomsms.com/api-management), currently just `sms.received`.

Writes straight into the existing `models.Activation` row -- looked up by
`bloomsms_id` (which is what `data.activation_id` in the payload matches,
per activations.py's `rent()`, which stores
`bloomsms_id=str(data["activation_id"])`). No separate storage needed.

>>> UNCONFIRMED, FLAGGED: the payload example you pasted doesn't show a
signature header (no X-Signature / HMAC secret mentioned), so this does
NOT verify the request actually came from BloomSMS. Check the API
Management dashboard page for a signing secret -- if one exists, verify
it here before relying on this in production. Until then this is
effectively an unauthenticated endpoint; consider at minimum checking
BloomSMS's published outbound IP range if they document one, or add a
shared-secret query param as a stopgap.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models
from app.database import get_db

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/webhooks/bloomsms", tags=["bloomsms-webhooks"])


@router.post("")
async def receive_bloomsms_webhook(request_body: dict, db: Session = Depends(get_db)):
    event = request_body.get("event")
    if event != "sms.received":
        # Unknown/future event type -- ack so BloomSMS doesn't retry, but
        # don't act on it.
        return {"received": True, "handled": False}

    data = request_body.get("data") or {}
    bloomsms_activation_id = data.get("activation_id")
    sms = data.get("sms") or {}
    code = sms.get("code")

    if not bloomsms_activation_id or not code:
        return {"received": True, "handled": False, "error": "missing activation_id or code"}

    activation = (
        db.query(models.Activation)
        .filter(models.Activation.bloomsms_id == str(bloomsms_activation_id))
        .first()
    )
    if activation is None:
        # Don't 404 -- BloomSMS isn't at fault if we can't find a matching
        # row (e.g. a stale/duplicate webhook retry). Log and ack.
        logger.warning(
            "sms.received webhook for unknown bloomsms_id=%s", bloomsms_activation_id
        )
        return {"received": True, "handled": False, "error": "unknown activation"}

    activation.code = code
    db.add(activation)
    db.commit()

    return {"received": True, "handled": True}

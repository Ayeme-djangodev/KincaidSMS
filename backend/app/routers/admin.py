"""
app/routers/admin.py

ADMIN ADDITION. Every endpoint here is gated by get_current_admin (403
for any non-admin user) -- that dependency has existed since day one in
deps.py, just never had a router wired to it until now.

Deliberately returns plain dicts (naira pre-converted server-side) from
GET endpoints rather than strict response_models -- see schemas.py note.
This is internal tooling, not a public API surface.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import get_current_admin
from app.fx import get_usd_to_ngn_rate, naira_to_usd_cents, usd_cents_to_naira

router = APIRouter(prefix="/admin", tags=["admin"])

logger = logging.getLogger("uvicorn.error")


def _enum_val(x):
    return x.value if hasattr(x, "value") else x


# ---------- Users ----------

@router.get("/users")
def list_users(
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    rate = get_usd_to_ngn_rate()
    users = db.query(models.User).order_by(models.User.created_at.desc()).all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "balance_naira": usd_cents_to_naira(u.balance_cents, rate=rate),
            "is_admin": u.is_admin,
            "created_at": u.created_at,
        }
        for u in users
    ]


@router.post("/users/{user_id}/adjust-balance", response_model=schemas.TransactionOut)
def adjust_balance(
    user_id: int,
    payload: schemas.AdjustBalanceRequest,
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    """
    Manually credits or debits a user's wallet, with a full audit-trail
    WalletTransaction entry (type=adjustment, which has existed in the
    TransactionType enum since day one but had no way to be created
    until now). amount_naira can be negative for a debit.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    rate = get_usd_to_ngn_rate()
    amount_cents = naira_to_usd_cents(payload.amount_naira, rate=rate)

    user.balance_cents += amount_cents
    db.add(user)

    txn = models.WalletTransaction(
        user_id=user.id,
        type=models.TransactionType.adjustment,
        amount_cents=amount_cents,
        balance_after_cents=user.balance_cents,
        description=f"Admin adjustment by {admin.email}: {payload.description}",
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return txn


# ---------- Transactions (all users) ----------

@router.get("/transactions")
def list_all_transactions(
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    rate = get_usd_to_ngn_rate()
    rows = (
        db.query(models.WalletTransaction)
        .order_by(models.WalletTransaction.created_at.desc())
        .limit(limit)
        .all()
    )
    out = []
    for t in rows:
        user = db.query(models.User).filter(models.User.id == t.user_id).first()
        out.append(
            {
                "id": t.id,
                "user_email": user.email if user else None,
                "type": _enum_val(t.type),
                "amount_naira": usd_cents_to_naira(t.amount_cents, rate=rate),
                "balance_after_naira": usd_cents_to_naira(t.balance_after_cents, rate=rate),
                "description": t.description,
                "created_at": t.created_at,
            }
        )
    return out


# ---------- Deposits (TransactPay) ----------
# The critical "catch stuck payments" view -- a deposit whose widget
# onCompleted never fired (e.g. the unresolved redirect issue) and whose
# webhook never arrived either will sit here as "pending" indefinitely
# until someone looks.

@router.get("/deposits")
def list_deposit_intents(
    status: Optional[str] = Query(None, description="Filter: pending | completed | failed"),
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    q = db.query(models.DepositIntent)
    if status:
        q = q.filter(models.DepositIntent.status == status)
    intents = q.order_by(models.DepositIntent.created_at.desc()).limit(200).all()

    out = []
    for i in intents:
        user = db.query(models.User).filter(models.User.id == i.user_id).first()
        out.append(
            {
                "id": i.id,
                "user_email": user.email if user else None,
                "reference": i.reference,
                "amount_naira": i.amount_naira,
                "status": _enum_val(i.status),
                "transactpay_reference": i.transactpay_reference,
                "created_at": i.created_at,
                "updated_at": i.updated_at,
            }
        )
    return out


@router.post("/deposits/{intent_id}/retry-verify")
def retry_verify_deposit(
    intent_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    """
    Manually re-triggers server-side verification for a deposit stuck in
    "pending" -- e.g. the customer paid but the widget's onCompleted
    never fired and the webhook never arrived. Reuses the EXACT SAME
    idempotent credit function used by the normal /wallet/deposit/verify
    endpoint and the webhook, so this can never double-credit no matter
    how many times it's clicked.
    """
    from app.routers.wallet import _credit_deposit_if_successful  # local import avoids a circular import at module load

    intent = db.query(models.DepositIntent).filter(models.DepositIntent.id == intent_id).first()
    if not intent:
        raise HTTPException(status_code=404, detail="Deposit intent not found")

    return _credit_deposit_if_successful(db, intent)


# ---------- Cross-provider activity (all users) ----------

@router.get("/activity")
def list_all_activity(
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    """Combined rentals/verifications/activations across ALL users, newest first."""
    rate = get_usd_to_ngn_rate()

    def _row(obj, provider, label):
        user = db.query(models.User).filter(models.User.id == obj.user_id).first()
        return {
            "provider": provider,
            "label": label,
            "user_email": user.email if user else None,
            "service": obj.service_display_name or obj.service_api_name,
            "number": obj.number,
            "status": _enum_val(obj.status),
            "charged_naira": usd_cents_to_naira(obj.charged_cents, rate=rate),
            "created_at": obj.created_at,
        }

    out = []
    for r in db.query(models.Rental).order_by(models.Rental.created_at.desc()).limit(limit).all():
        out.append(_row(r, "getatext", "Service 1"))
    for v in db.query(models.Verification).order_by(models.Verification.created_at.desc()).limit(limit).all():
        out.append(_row(v, "textverified", "Service 2"))
    for a in db.query(models.Activation).order_by(models.Activation.created_at.desc()).limit(limit).all():
        out.append(_row(a, "bloomsms", "Service 3"))

    out.sort(key=lambda x: x["created_at"], reverse=True)
    return out[:limit]

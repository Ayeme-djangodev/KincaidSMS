import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.fx import get_usd_to_ngn_rate, naira_to_usd_cents
from app.transactpay_client import verify_order, is_order_successful, TransactPayError

router = APIRouter(prefix="/wallet", tags=["wallet"])

logger = logging.getLogger("uvicorn.error")


@router.get("/balance")
def balance(current_user: models.User = Depends(get_current_user)):
    return {"balance_cents": current_user.balance_cents}


@router.get("/transactions", response_model=list[schemas.TransactionOut])
def transactions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return (
        db.query(models.WalletTransaction)
        .filter(models.WalletTransaction.user_id == current_user.id)
        .order_by(models.WalletTransaction.created_at.desc())
        .all()
    )


# ---------- TransactPay deposits ----------
# TRANSACTPAY ADDITION. Replaces the old POST /wallet/deposit stub, which
# credited the wallet on any authenticated call with no payment check at
# all -- that endpoint is REMOVED, not left in alongside this. The old
# frontend Top Up forms (Sidebar.jsx, Wallet.jsx) called that stub
# directly and will break until updated to this two-step flow:
#   1. POST /wallet/deposit/initiate -> get a widget config bundle
#   2. Frontend launches TransactPay's Standard Kit widget with it
#   3. On the widget's onCompleted callback, POST /wallet/deposit/verify
#      -> backend independently re-checks with TransactPay before
#      crediting anything, per their own docs' recommendation.


def _generate_reference(user_id: int) -> str:
    return f"kincaid-dep-{user_id}-{secrets.token_hex(6)}"


def _placeholder_name(email: str) -> tuple[str, str]:
    """
    You don't want to collect real names from customers, but TransactPay's
    Standard Kit widget config expects firstName/lastName fields. Rather
    than prompt for names, this derives generic placeholders from the
    account email -- e.g. "jane.doe@x.com" -> ("jane.doe", "Customer").
    If TransactPay's checkout ever rejects these as invalid (some payment
    processors validate names for KYC/receipt purposes), that would need
    revisiting -- flagging this as untested against a real transaction.
    """
    local_part = email.split("@")[0] or "Customer"
    return local_part, "Customer"


@router.post("/deposit/initiate", response_model=schemas.DepositInitiateResponse)
def initiate_deposit(
    payload: schemas.DepositInitiateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rate = get_usd_to_ngn_rate()
    amount_cents = naira_to_usd_cents(payload.amount_naira, rate=rate)

    if amount_cents <= 0:
        raise HTTPException(status_code=400, detail="Amount too small")

    reference = _generate_reference(current_user.id)
    first_name, last_name = _placeholder_name(current_user.email)

    intent = models.DepositIntent(
        user_id=current_user.id,
        reference=reference,
        amount_naira=payload.amount_naira,
        amount_cents=amount_cents,
        fx_rate_used=rate,
        status=models.DepositStatus.pending,
    )
    db.add(intent)
    db.commit()
    db.refresh(intent)

    return schemas.DepositInitiateResponse(
        reference=reference,
        public_key=settings.TRANSACTPAY_PUBLIC_KEY,
        encryption_key=settings.TRANSACTPAY_ENCRYPTION_KEY,
        amount_naira=payload.amount_naira,
        currency="NGN",
        email=current_user.email,
        first_name=first_name,
        last_name=last_name,
        mobile=settings.TRANSACTPAY_PLACEHOLDER_MOBILE,
        country=payload.country,
    )


def _credit_deposit_if_successful(db: Session, intent: models.DepositIntent) -> schemas.DepositVerifyResponse:
    """
    Shared idempotent credit logic -- used by both the frontend-triggered
    /verify endpoint and the webhook receiver below, so a deposit can
    never be credited twice no matter which path confirms it first.
    """
    user = db.query(models.User).filter(models.User.id == intent.user_id).first()

    if intent.status == models.DepositStatus.completed:
        # Already credited (e.g. webhook beat the frontend /verify call,
        # or the user refreshed and triggered /verify twice). Return the
        # existing state rather than crediting again.
        txn = (
            db.query(models.WalletTransaction)
            .filter(models.WalletTransaction.deposit_intent_id == intent.id)
            .first()
        )
        return schemas.DepositVerifyResponse(
            status="completed",
            balance_cents=user.balance_cents,
            transaction=txn,
        )

    try:
        status_payload = verify_order(intent.reference)
    except TransactPayError as e:
        logger.error("TransactPay verify failed for %r: %s", intent.reference, e.message)
        return schemas.DepositVerifyResponse(status="pending", balance_cents=user.balance_cents)

    if not is_order_successful(status_payload):
        return schemas.DepositVerifyResponse(status="pending", balance_cents=user.balance_cents)

    # Confirmed successful -- credit using the amount LOCKED IN at
    # initiate time, never anything from the TransactPay response itself.
    user.balance_cents += intent.amount_cents
    db.add(user)

    txn = models.WalletTransaction(
        user_id=user.id,
        type=models.TransactionType.deposit,
        amount_cents=intent.amount_cents,
        balance_after_cents=user.balance_cents,
        description=f"Deposit via TransactPay ({intent.reference})",
        deposit_intent_id=intent.id,
    )
    db.add(txn)

    intent.status = models.DepositStatus.completed
    db.add(intent)

    db.commit()
    db.refresh(txn)
    db.refresh(user)

    return schemas.DepositVerifyResponse(
        status="completed",
        balance_cents=user.balance_cents,
        transaction=txn,
    )


@router.post("/deposit/verify/{reference}", response_model=schemas.DepositVerifyResponse)
def verify_deposit(
    reference: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Called by the frontend right after the Standard Kit widget's
    onCompleted() callback fires. Does NOT trust that callback's claimed
    status -- independently re-checks with TransactPay before crediting.
    """
    intent = (
        db.query(models.DepositIntent)
        .filter(models.DepositIntent.reference == reference)
        .first()
    )
    if not intent or intent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Deposit not found")

    return _credit_deposit_if_successful(db, intent)


@router.post("/deposit/webhook")
def deposit_webhook(payload: dict, db: Session = Depends(get_db)):
    """
    Backup confirmation path in case the customer closes the tab before
    the frontend can call /verify. Per TransactPay's docs, this must
    return HTTP 200 -- always returns 200 here even on internal issues,
    logging problems rather than raising, since /verify (triggered by the
    frontend) is the primary path and this is just a safety net.

    >>> UNCONFIRMED: no signature verification is implemented -- I could
    not find TransactPay's specific webhook-signing scheme in their docs.
    This is treated as an UNTRUSTED trigger only: the payload's reference
    is extracted defensively (tried under a few plausible key names) and
    then verify_order() is called server-side for the real answer, same
    as the /verify endpoint -- the payload's claimed status/amount is
    never used directly to credit anything. This is standard
    defense-in-depth practice regardless of whether signature
    verification is ever added.
    """
    reference = (
        payload.get("reference")
        or payload.get("merchantReference")
        or (payload.get("data") or {}).get("reference")
        or (payload.get("order") or {}).get("reference")
    )

    logger.info("Received TransactPay webhook, extracted reference=%r, raw=%r", reference, payload)

    if not reference:
        logger.warning("TransactPay webhook had no extractable reference, ignoring")
        return {"received": True}

    intent = (
        db.query(models.DepositIntent)
        .filter(models.DepositIntent.reference == reference)
        .first()
    )
    if not intent:
        logger.warning("TransactPay webhook referenced unknown deposit %r, ignoring", reference)
        return {"received": True}

    try:
        _credit_deposit_if_successful(db, intent)
    except Exception:
        logger.exception("Error processing TransactPay webhook for %r", reference)

    return {"received": True}

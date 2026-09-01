from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.fx import get_usd_to_ngn_rate, naira_to_usd_cents, usd_cents_to_naira
from app.textverified_client import (
    create_verification,
    get_sms_code,
    cancel_verification,
    TextVerifiedClientError,
)

router = APIRouter(prefix="/verifications", tags=["verifications"])

MARKUP = settings.MARKUP_PERCENT


def _to_cents(value) -> int:
    return round(float(value) * 100)


def _get_owned_verification(db: Session, verification_id: int, user: models.User) -> models.Verification:
    v = (
        db.query(models.Verification)
        .filter(models.Verification.id == verification_id)
        .first()
    )
    if not v or v.user_id != user.id:
        raise HTTPException(status_code=404, detail="Verification not found")
    return v


def _resolve_customer_max_cents(max_price_cents, max_price_naira, fallback_cents) -> int:
    if max_price_cents is not None:
        return max_price_cents
    if max_price_naira is not None:
        return naira_to_usd_cents(max_price_naira)
    return fallback_cents


def _attach_naira(v: models.Verification, rate=None) -> models.Verification:
    if rate is None:
        rate = get_usd_to_ngn_rate()
    v.cost_naira = usd_cents_to_naira(v.cost_cents, rate=rate)
    v.charged_naira = usd_cents_to_naira(v.charged_cents, rate=rate)
    return v


def _charge_wallet(db: Session, user: models.User, amount_cents: int, verification_id: int, description: str):
    user.balance_cents -= amount_cents
    db.add(user)
    txn = models.WalletTransaction(
        user_id=user.id,
        type=models.TransactionType.rental_charge,
        amount_cents=-amount_cents,
        balance_after_cents=user.balance_cents,
        description=description,
        verification_id=verification_id,
    )
    db.add(txn)


def _refund_wallet(db: Session, user: models.User, amount_cents: int, verification_id: int, description: str):
    if amount_cents <= 0:
        return
    user.balance_cents += amount_cents
    db.add(user)
    txn = models.WalletTransaction(
        user_id=user.id,
        type=models.TransactionType.rental_refund,
        amount_cents=amount_cents,
        balance_after_cents=user.balance_cents,
        description=description,
        verification_id=verification_id,
    )
    db.add(txn)


@router.post("/rent", response_model=schemas.VerificationOut, status_code=201)
def rent(
    payload: schemas.CreateVerificationRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    customer_max_cents = _resolve_customer_max_cents(
        payload.max_price_cents, payload.max_price_naira, current_user.balance_cents
    )
    if customer_max_cents <= 0:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    base_max_price = (customer_max_cents / (1 + MARKUP)) / 100

    try:
        data = create_verification(
            service_name=payload.service,
            capability="sms",
            max_price=round(base_max_price, 2),
        )
    except TextVerifiedClientError as e:
        raise HTTPException(status_code=e.status_code if e.status_code < 500 else 502, detail=e.message)

    cost_cents = _to_cents(data["cost"])
    charged_cents = round(cost_cents * (1 + MARKUP))

    if charged_cents > current_user.balance_cents:
        # Same protective pattern as rentals.py: TextVerified already
        # charged our account balance, so don't leave it dangling -- try
        # to cancel immediately and surface an error.
        try:
            cancel_verification(data["id"])
        except TextVerifiedClientError:
            pass
        raise HTTPException(status_code=400, detail="Insufficient balance for the final price")

    verification = models.Verification(
        user_id=current_user.id,
        textverified_id=data["id"],
        service_api_name=payload.service,
        service_display_name=payload.service,
        number=data.get("number"),
        cost_cents=cost_cents,
        charged_cents=charged_cents,
        status=models.RentalStatus.active,
    )
    db.add(verification)
    db.flush()

    _charge_wallet(
        db,
        current_user,
        charged_cents,
        verification.id,
        f"Verification of {payload.service} ({verification.number})",
    )

    db.commit()
    db.refresh(verification)
    return _attach_naira(verification)


@router.get("", response_model=list[schemas.VerificationOut])
def list_verifications(
    db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)
):
    verifications = (
        db.query(models.Verification)
        .filter(models.Verification.user_id == current_user.id)
        .order_by(models.Verification.created_at.desc())
        .all()
    )
    rate = get_usd_to_ngn_rate()
    return [_attach_naira(v, rate=rate) for v in verifications]


@router.get("/{verification_id}", response_model=schemas.VerificationOut)
def get_verification(
    verification_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    v = _get_owned_verification(db, verification_id, current_user)
    return _attach_naira(v)


@router.get("/{verification_id}/poll", response_model=schemas.VerificationOut)
def poll_verification_status(
    verification_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Same polling pattern as rentals.py's /rentals/{id}/poll -- frontend
    hits this every 5s to check for the incoming SMS code.
    """
    v = _get_owned_verification(db, verification_id, current_user)

    if v.status != models.RentalStatus.active:
        return _attach_naira(v)

    try:
        code = get_sms_code(v.textverified_id)
    except TextVerifiedClientError as e:
        raise HTTPException(status_code=e.status_code if e.status_code < 500 else 502, detail=e.message)

    if code:
        v.code = code
        db.add(v)
        db.commit()
        db.refresh(v)

    return _attach_naira(v)


@router.post("/{verification_id}/cancel", response_model=schemas.VerificationOut)
def cancel(
    verification_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    v = _get_owned_verification(db, verification_id, current_user)
    if v.status != models.RentalStatus.active:
        raise HTTPException(status_code=400, detail="Only active verifications can be cancelled")

    try:
        cancel_verification(v.textverified_id)
    except TextVerifiedClientError as e:
        raise HTTPException(status_code=e.status_code if e.status_code < 500 else 502, detail=e.message)

    # UNCONFIRMED, FLAGGED: unlike Getatext's cancel-rental response (which
    # tells us the final prorated cost so we can refund the difference),
    # I don't have confirmation that TextVerified's cancel() returns a
    # final-cost figure at all -- their python client's cancel() just
    # returns a bool per its docs. Refunding the FULL charged amount here
    # as the safe default (rather than assuming partial usage like
    # Getatext) until this is confirmed against a real response.
    v.status = models.RentalStatus.cancelled
    db.add(v)

    _refund_wallet(
        db,
        current_user,
        v.charged_cents,
        v.id,
        f"Refund for cancelled verification ({v.number})",
    )

    db.commit()
    db.refresh(v)
    return _attach_naira(v)

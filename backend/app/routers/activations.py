from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.fx import get_usd_to_ngn_rate, naira_to_usd_cents, usd_cents_to_naira
from app.bloomsms_client import (
    rent_activation,
    get_activation_status,
    update_activation_status,
    BloomSMSError,
)

router = APIRouter(prefix="/activations", tags=["activations"])

MARKUP = settings.MARKUP_PERCENT


def _to_cents(value) -> int:
    return round(float(value) * 100)


def _get_owned_activation(db: Session, activation_id: int, user: models.User) -> models.Activation:
    a = (
        db.query(models.Activation)
        .filter(models.Activation.id == activation_id)
        .first()
    )
    if not a or a.user_id != user.id:
        raise HTTPException(status_code=404, detail="Activation not found")
    return a


def _resolve_customer_max_cents(max_price_cents, max_price_naira, fallback_cents) -> int:
    if max_price_cents is not None:
        return max_price_cents
    if max_price_naira is not None:
        return naira_to_usd_cents(max_price_naira)
    return fallback_cents


def _attach_naira(a: models.Activation, rate=None) -> models.Activation:
    if rate is None:
        rate = get_usd_to_ngn_rate()
    a.cost_naira = usd_cents_to_naira(a.cost_cents, rate=rate)
    a.charged_naira = usd_cents_to_naira(a.charged_cents, rate=rate)
    return a


def _charge_wallet(db: Session, user: models.User, amount_cents: int, activation_id: int, description: str):
    user.balance_cents -= amount_cents
    db.add(user)
    txn = models.WalletTransaction(
        user_id=user.id,
        type=models.TransactionType.rental_charge,
        amount_cents=-amount_cents,
        balance_after_cents=user.balance_cents,
        description=description,
        activation_id=activation_id,
    )
    db.add(txn)


def _refund_wallet(db: Session, user: models.User, amount_cents: int, activation_id: int, description: str):
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
        activation_id=activation_id,
    )
    db.add(txn)


@router.post("/rent", response_model=schemas.ActivationOut, status_code=201)
def rent(
    payload: schemas.RentActivationRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    customer_max_cents = _resolve_customer_max_cents(
        payload.max_price_cents, payload.max_price_naira, current_user.balance_cents
    )
    if customer_max_cents <= 0:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    # Same protective pattern as Getatext: convert the customer's
    # post-markup ceiling down to a base-price ceiling and let BloomSMS
    # itself refuse if the real cost would exceed it (their docs confirm
    # max_price is accepted directly on the rent endpoint).
    base_max_price = (customer_max_cents / (1 + MARKUP)) / 100

    try:
        data = rent_activation(
            service=payload.service,
            country=payload.country,
            max_price=round(base_max_price, 2),
        )
    except BloomSMSError as e:
        raise HTTPException(status_code=e.status_code if e.status_code < 500 else 502, detail=e.message)

    cost_cents = _to_cents(data["price"])
    charged_cents = round(cost_cents * (1 + MARKUP))

    if charged_cents > current_user.balance_cents:
        try:
            update_activation_status(data["activation_id"], "cancel")
        except BloomSMSError:
            pass
        raise HTTPException(status_code=400, detail="Insufficient balance for the final price")

    activation = models.Activation(
        user_id=current_user.id,
        bloomsms_id=str(data["activation_id"]),
        service_api_name=payload.service,
        service_display_name=payload.service,
        number=data.get("phone_number"),
        cost_cents=cost_cents,
        charged_cents=charged_cents,
        status=models.RentalStatus.active,
        end_time=data.get("expires_at"),
    )
    db.add(activation)
    db.flush()

    _charge_wallet(
        db,
        current_user,
        charged_cents,
        activation.id,
        f"Activation of {payload.service} ({activation.number})",
    )

    db.commit()
    db.refresh(activation)
    return _attach_naira(activation)


@router.get("", response_model=list[schemas.ActivationOut])
def list_activations(
    db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)
):
    activations = (
        db.query(models.Activation)
        .filter(models.Activation.user_id == current_user.id)
        .order_by(models.Activation.created_at.desc())
        .all()
    )
    rate = get_usd_to_ngn_rate()
    return [_attach_naira(a, rate=rate) for a in activations]


@router.get("/{activation_id}", response_model=schemas.ActivationOut)
def get_activation(
    activation_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    a = _get_owned_activation(db, activation_id, current_user)
    return _attach_naira(a)


@router.get("/{activation_id}/poll", response_model=schemas.ActivationOut)
def poll_activation_status(
    activation_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Same polling pattern as rentals.py / verifications.py."""
    a = _get_owned_activation(db, activation_id, current_user)

    if a.status != models.RentalStatus.active:
        return _attach_naira(a)

    try:
        data = get_activation_status(a.bloomsms_id)
    except BloomSMSError as e:
        raise HTTPException(status_code=e.status_code if e.status_code < 500 else 502, detail=e.message)

    sms = data.get("sms") or {}
    a.code = sms.get("code") or a.code

    bloom_status = data.get("activation_status")
    if bloom_status == "completed":
        a.status = models.RentalStatus.completed
    elif bloom_status == "cancelled":
        a.status = models.RentalStatus.cancelled
    # "waiting" / "code_received" both stay "active" -- matches Getatext's
    # poll semantics (still open, may or may not have a code yet)

    db.add(a)
    db.commit()
    db.refresh(a)
    return _attach_naira(a)


@router.post("/{activation_id}/cancel", response_model=schemas.ActivationOut)
def cancel(
    activation_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    a = _get_owned_activation(db, activation_id, current_user)
    if a.status != models.RentalStatus.active:
        raise HTTPException(status_code=400, detail="Only active activations can be cancelled")

    try:
        data = update_activation_status(a.bloomsms_id, "cancel")
    except BloomSMSError as e:
        raise HTTPException(status_code=e.status_code if e.status_code < 500 else 502, detail=e.message)

    # UNCONFIRMED, FLAGGED (see bloomsms_client.py notes): their docs don't
    # show an example response body for cancelling a SHORT-TERM activation
    # (only long-rental cancel shows a refund_amount field). If this
    # response happens to include a usable cost/refund figure, use it;
    # otherwise fall back to refunding the full charged amount, same
    # conservative default used for TextVerified's cancel.
    refund_cents = None
    if data:
        for key in ("refund_amount", "price", "cost"):
            if data.get(key) is not None:
                refund_cents = _to_cents(data[key])
                break

    if refund_cents is None:
        refund_cents = a.charged_cents

    a.status = models.RentalStatus.cancelled
    db.add(a)

    _refund_wallet(
        db,
        current_user,
        refund_cents,
        a.id,
        f"Refund for cancelled activation ({a.number})",
    )

    db.commit()
    db.refresh(a)
    return _attach_naira(a)


@router.post("/{activation_id}/complete", response_model=schemas.ActivationOut)
def complete(
    activation_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    a = _get_owned_activation(db, activation_id, current_user)
    if a.status != models.RentalStatus.active:
        raise HTTPException(status_code=400, detail="Only active activations can be completed")

    try:
        update_activation_status(a.bloomsms_id, "complete")
    except BloomSMSError as e:
        raise HTTPException(status_code=e.status_code if e.status_code < 500 else 502, detail=e.message)

    a.status = models.RentalStatus.completed
    db.add(a)
    db.commit()
    db.refresh(a)
    return _attach_naira(a)

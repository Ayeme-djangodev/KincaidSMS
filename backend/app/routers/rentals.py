from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.fx import get_usd_to_ngn_rate, naira_to_usd_cents, usd_cents_to_naira
from app.getatext_client import (
    rent_a_number,
    rent_specific_number,
    cancel_rental,
    rental_status,
    mark_completed,
    GetatextError,
)

router = APIRouter(prefix="/rentals", tags=["rentals"])

MARKUP = settings.MARKUP_PERCENT


def _to_cents(value) -> int:
    return round(float(value) * 100)


def _get_owned_rental(db: Session, rental_id: int, user: models.User) -> models.Rental:
    rental = db.query(models.Rental).filter(models.Rental.id == rental_id).first()
    if not rental or rental.user_id != user.id:
        raise HTTPException(status_code=404, detail="Rental not found")
    return rental


def _resolve_customer_max_cents(max_price_cents, max_price_naira, fallback_cents) -> int:
    """
    NAIRA ADDITION.
    Figures out the customer's price ceiling in USD cents, accepting either
    a direct cents value or a naira value from the frontend. If both are
    given, cents wins (it's the more direct/precise figure -- naira is
    converted through a live-ish rate and shouldn't override an explicit
    cents number). Falls back to the user's current balance if neither
    is supplied.
    """
    if max_price_cents is not None:
        return max_price_cents
    if max_price_naira is not None:
        return naira_to_usd_cents(max_price_naira)
    return fallback_cents


def _attach_naira(rental: models.Rental, rate=None) -> models.Rental:
    """
    NAIRA ADDITION.
    Attaches display-only naira conversions of cost_cents/charged_cents
    onto the rental object before it's serialized via RentalOut. These are
    NOT persisted columns -- just set at request time so the frontend can
    show naira without the wallet ledger ever leaving USD.
    """
    if rate is None:
        rate = get_usd_to_ngn_rate()
    rental.cost_naira = usd_cents_to_naira(rental.cost_cents, rate=rate)
    rental.charged_naira = usd_cents_to_naira(rental.charged_cents, rate=rate)
    return rental


def _charge_wallet(db: Session, user: models.User, amount_cents: int, rental_id: int, description: str):
    """Debit the user's wallet. amount_cents should be positive (the amount to deduct)."""
    user.balance_cents -= amount_cents
    db.add(user)
    txn = models.WalletTransaction(
        user_id=user.id,
        type=models.TransactionType.rental_charge,
        amount_cents=-amount_cents,
        balance_after_cents=user.balance_cents,
        description=description,
        rental_id=rental_id,
    )
    db.add(txn)


def _refund_wallet(db: Session, user: models.User, amount_cents: int, rental_id: int, description: str):
    """Credit the user's wallet. amount_cents should be positive (the amount to credit back)."""
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
        rental_id=rental_id,
    )
    db.add(txn)


@router.post("/rent", response_model=schemas.RentalOut, status_code=201)
def rent(
    payload: schemas.RentNumberRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # The customer's ceiling, in cents, on what THEY are willing to pay
    # (post-markup). Accepts either cents or naira from the frontend now.
    # Defaults to their current balance if neither is supplied.
    customer_max_cents = _resolve_customer_max_cents(
        payload.max_price_cents, payload.max_price_naira, current_user.balance_cents
    )
    if customer_max_cents <= 0:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    # Convert to the base price ceiling we tell Getatext about, so Getatext
    # itself refuses if the real cost would exceed what the customer can pay.
    base_max_price = (customer_max_cents / (1 + MARKUP)) / 100

    try:
        data = rent_a_number(
            service=payload.service,
            max_price=round(base_max_price, 2),
            carrier=payload.carrier,
            keep_carrier=payload.keep_carrier,
            lock_area_code=payload.lock_area_code,
            area_codes=payload.area_codes,
        )
    except GetatextError as e:
        raise HTTPException(status_code=e.status_code if e.status_code < 500 else 502, detail=e.message)

    cost_cents = _to_cents(data["price"])
    charged_cents = round(cost_cents * (1 + MARKUP))

    if charged_cents > current_user.balance_cents:
        # Shouldn't normally happen since we capped max_price above, but Getatext
        # already rented the number and charged our account -- don't leave it
        # dangling. Try to cancel immediately and surface an error.
        try:
            cancel_rental(data["id"])
        except GetatextError:
            pass
        raise HTTPException(status_code=400, detail="Insufficient balance for the final price")

    rental = models.Rental(
        user_id=current_user.id,
        getatext_id=data["id"],
        service_api_name=payload.service,
        service_display_name=data.get("service_name"),
        number=data.get("number"),
        cost_cents=cost_cents,
        charged_cents=charged_cents,
        status=models.RentalStatus.active,
        end_time=data.get("end_time"),
    )
    db.add(rental)
    db.flush()  # get rental.id before creating the wallet transaction

    _charge_wallet(
        db,
        current_user,
        charged_cents,
        rental.id,
        f"Rental of {rental.service_display_name or payload.service} ({rental.number})",
    )

    db.commit()
    db.refresh(rental)
    return _attach_naira(rental)


@router.post("/rent-specific", response_model=schemas.RentalOut, status_code=201)
def rent_specific(
    payload: schemas.RentSpecificNumberRequest,
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
        data = rent_specific_number(
            number=payload.number,
            service=payload.service,
            max_price=round(base_max_price, 2),
        )
    except GetatextError as e:
        raise HTTPException(status_code=e.status_code if e.status_code < 500 else 502, detail=e.message)

    cost_cents = _to_cents(data["price"])
    charged_cents = round(cost_cents * (1 + MARKUP))

    if charged_cents > current_user.balance_cents:
        try:
            cancel_rental(data["id"])
        except GetatextError:
            pass
        raise HTTPException(status_code=400, detail="Insufficient balance for the final price")

    rental = models.Rental(
        user_id=current_user.id,
        getatext_id=data["id"],
        service_api_name=payload.service,
        service_display_name=data.get("service_name"),
        number=data.get("number"),
        cost_cents=cost_cents,
        charged_cents=charged_cents,
        status=models.RentalStatus.active,
        end_time=data.get("end_time"),
    )
    db.add(rental)
    db.flush()

    _charge_wallet(
        db,
        current_user,
        charged_cents,
        rental.id,
        f"Specific-number rental of {rental.service_display_name or payload.service} ({rental.number})",
    )

    db.commit()
    db.refresh(rental)
    return _attach_naira(rental)


@router.get("", response_model=list[schemas.RentalOut])
def list_rentals(
    db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)
):
    rentals = (
        db.query(models.Rental)
        .filter(models.Rental.user_id == current_user.id)
        .order_by(models.Rental.created_at.desc())
        .all()
    )
    # Fetch the rate once for the whole list rather than once per rental.
    rate = get_usd_to_ngn_rate()
    return [_attach_naira(r, rate=rate) for r in rentals]


@router.get("/{rental_id}", response_model=schemas.RentalOut)
def get_rental(
    rental_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rental = _get_owned_rental(db, rental_id, current_user)
    return _attach_naira(rental)


@router.get("/{rental_id}/poll", response_model=schemas.RentalOut)
def poll_rental_status(
    rental_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    This is the endpoint the frontend polls to check whether the SMS code
    has arrived yet. It calls Getatext's rental-status endpoint and syncs
    the local record.
    """
    rental = _get_owned_rental(db, rental_id, current_user)

    if rental.status not in (models.RentalStatus.active,):
        # Nothing to sync for terminal states.
        return _attach_naira(rental)

    try:
        data = rental_status(rental.getatext_id)
    except GetatextError as e:
        raise HTTPException(status_code=e.status_code if e.status_code < 500 else 502, detail=e.message)

    rental.code = data.get("code") or rental.code
    getatext_status = data.get("status")
    if getatext_status in ("cancelled",):
        rental.status = models.RentalStatus.cancelled
    elif getatext_status in ("completed",):
        rental.status = models.RentalStatus.completed
    # otherwise stays "active" (still waiting on a code / rental still open)

    db.add(rental)
    db.commit()
    db.refresh(rental)
    return _attach_naira(rental)


@router.post("/{rental_id}/cancel", response_model=schemas.RentalOut)
def cancel(
    rental_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rental = _get_owned_rental(db, rental_id, current_user)
    if rental.status != models.RentalStatus.active:
        raise HTTPException(status_code=400, detail="Only active rentals can be cancelled")

    try:
        data = cancel_rental(rental.getatext_id)
    except GetatextError as e:
        raise HTTPException(status_code=e.status_code if e.status_code < 500 else 502, detail=e.message)

    # Getatext's cancel response includes the final "cost" charged to us for
    # this rental, which may be less than the amount we originally reserved.
    # Refund the customer the difference (adjusted by our markup). NOTE:
    # confirm Getatext's actual cancellation-cost behavior with their support
    # before relying on this in production -- it is not fully spelled out in
    # the docs.
    final_cost_cents = _to_cents(data.get("cost", 0))
    final_charged_cents = round(final_cost_cents * (1 + MARKUP))
    refund_cents = max(rental.charged_cents - final_charged_cents, 0)

    rental.status = models.RentalStatus.cancelled
    rental.cost_cents = final_cost_cents
    rental.charged_cents = final_charged_cents
    db.add(rental)

    _refund_wallet(
        db,
        current_user,
        refund_cents,
        rental.id,
        f"Refund for cancelled rental ({rental.number})",
    )

    db.commit()
    db.refresh(rental)
    return _attach_naira(rental)


@router.post("/{rental_id}/complete", response_model=schemas.RentalOut)
def complete(
    rental_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rental = _get_owned_rental(db, rental_id, current_user)
    if rental.status != models.RentalStatus.active:
        raise HTTPException(status_code=400, detail="Only active rentals can be completed")

    try:
        data = mark_completed(rental.getatext_id)
    except GetatextError as e:
        raise HTTPException(status_code=e.status_code if e.status_code < 500 else 502, detail=e.message)

    rental.status = models.RentalStatus.completed
    db.add(rental)
    db.commit()
    db.refresh(rental)
    return _attach_naira(rental)

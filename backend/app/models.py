import enum
from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    Enum,
    Text,
)
from sqlalchemy.orm import relationship

from app.database import Base


class TransactionType(str, enum.Enum):
    deposit = "deposit"
    rental_charge = "rental_charge"
    rental_refund = "rental_refund"
    adjustment = "adjustment"


class RentalStatus(str, enum.Enum):
    active = "active"
    completed = "completed"
    cancelled = "cancelled"
    failed = "failed"


class DepositStatus(str, enum.Enum):
    """TRANSACTPAY ADDITION."""

    pending = "pending"
    completed = "completed"
    failed = "failed"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_admin = Column(Boolean, default=False)
    # Balance stored in cents (integer) to avoid floating point rounding issues.
    balance_cents = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    transactions = relationship("WalletTransaction", back_populates="user")
    rentals = relationship("Rental", back_populates="user")
    # TEXTVERIFIED ADDITION
    verifications = relationship("Verification", back_populates="user")
    # BLOOMSMS ADDITION
    activations = relationship("Activation", back_populates="user")
    # TRANSACTPAY ADDITION
    deposit_intents = relationship("DepositIntent", back_populates="user")


class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    type = Column(Enum(TransactionType), nullable=False)
    amount_cents = Column(Integer, nullable=False)  # positive = credit, negative = debit
    balance_after_cents = Column(Integer, nullable=False)
    description = Column(String, nullable=True)
    rental_id = Column(Integer, ForeignKey("rentals.id"), nullable=True)
    # TEXTVERIFIED ADDITION. Nullable, parallel to rental_id -- a given
    # transaction is linked to at most one of rental_id / verification_id,
    # never both, depending on which provider it came from.
    verification_id = Column(Integer, ForeignKey("verifications.id"), nullable=True)
    # BLOOMSMS ADDITION. Same nullable/parallel pattern as verification_id
    # above -- a transaction links to at most one of rental_id /
    # verification_id / activation_id.
    activation_id = Column(Integer, ForeignKey("activations.id"), nullable=True)
    # TRANSACTPAY ADDITION. Links the credited deposit transaction back to
    # the DepositIntent that verified it, for audit purposes.
    deposit_intent_id = Column(Integer, ForeignKey("deposit_intents.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="transactions")


class Rental(Base):
    __tablename__ = "rentals"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Getatext's own rental id, needed for status/cancel/complete calls
    getatext_id = Column(Integer, nullable=True, index=True)

    service_api_name = Column(String, nullable=False)
    service_display_name = Column(String, nullable=True)
    number = Column(String, nullable=True)

    # What Getatext actually charged us (in cents)
    cost_cents = Column(Integer, nullable=False, default=0)
    # What we charged the customer (in cents) = cost_cents * (1 + markup)
    charged_cents = Column(Integer, nullable=False, default=0)

    status = Column(Enum(RentalStatus), default=RentalStatus.active, nullable=False)
    code = Column(String, nullable=True)

    end_time = Column(String, nullable=True)  # Getatext returns this as a string timestamp
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="rentals")


class Verification(Base):
    """
    TEXTVERIFIED ADDITION.
    Deliberately a separate table from Rental rather than a shared table
    with a provider column (your call) -- TextVerified's own domain
    language is "verification", not "rental", and the two providers'
    lifecycles/fields don't map 1:1 (no Getatext-style "complete" action
    here, TextVerified has reactivate/reuse/report instead -- those are
    out of scope for now, see PROGRESS_NOTES).

    Mirrors Rental's shape closely so the two are easy to reason about
    side by side, and so wallet ledger entries look the same regardless
    of which provider they came from.
    """

    __tablename__ = "verifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # TextVerified's own id for this verification. Their IDs are strings
    # (not ints like Getatext's), per their API docs/python client.
    textverified_id = Column(String, nullable=True, index=True)

    service_api_name = Column(String, nullable=False)
    service_display_name = Column(String, nullable=True)
    number = Column(String, nullable=True)

    # What TextVerified actually charged us (in cents, converted from the
    # USD amount their API reports -- their account balance is USD).
    cost_cents = Column(Integer, nullable=False, default=0)
    # What we charged the customer (in cents) = cost_cents * (1 + markup)
    charged_cents = Column(Integer, nullable=False, default=0)

    status = Column(Enum(RentalStatus), default=RentalStatus.active, nullable=False)
    code = Column(String, nullable=True)

    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="verifications")


class Activation(Base):
    """
    BLOOMSMS ADDITION.
    Separate table, mirroring the Verification/Rental split -- BloomSMS
    calls this an "activation" (their own term), and per your call this
    gets its own table + page rather than folding into an existing one.

    Structurally this is the closest of the three providers to Getatext:
    BloomSMS supports a real cancel AND complete status update (unlike
    TextVerified, which only has cancel), and accepts max_price directly
    on rent the same way Getatext does. So this table/router end up
    looking the most like rentals.py of the three.

    BloomSMS's separate "Long Rentals" system (1d/3d/7d/14d/30d periods,
    auto-renew, webhooks) is NOT implemented here -- out of scope for
    now, same treatment as Getatext's long-rentals and TextVerified's
    renewable-rental system. Only short-term activations.
    """

    __tablename__ = "activations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # BloomSMS's own activation id. Their docs show it as a quoted string
    # in JSON ("38496653") even though it looks numeric -- storing as
    # String to be safe rather than assuming it's always coercible to int.
    bloomsms_id = Column(String, nullable=True, index=True)

    service_api_name = Column(String, nullable=False)
    service_display_name = Column(String, nullable=True)
    number = Column(String, nullable=True)

    # What BloomSMS actually charged us (in cents)
    cost_cents = Column(Integer, nullable=False, default=0)
    # What we charged the customer (in cents) = cost_cents * (1 + markup)
    charged_cents = Column(Integer, nullable=False, default=0)

    status = Column(Enum(RentalStatus), default=RentalStatus.active, nullable=False)
    code = Column(String, nullable=True)

    end_time = Column(String, nullable=True)  # BloomSMS returns this as expires_at
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="activations")


class DepositIntent(Base):
    """
    TRANSACTPAY ADDITION.
    Created BEFORE the customer is handed off to TransactPay's checkout
    widget, so we have a server-side record of every deposit attempt --
    not just successful ones. This is the core of not trusting the
    client-side onCompleted() callback: the wallet only ever gets
    credited after the backend independently calls TransactPay's own
    status/verify endpoint and confirms success, using the amount LOCKED
    IN HERE at creation time (never re-trusting an amount from a webhook
    or client callback).

    reference is what we hand to the Standard Kit widget and what
    TransactPay's webhook/status calls key off of -- must be unique.
    """

    __tablename__ = "deposit_intents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    reference = Column(String, nullable=False, unique=True, index=True)

    # Locked in at creation time using the FX rate at that moment. The
    # wallet gets credited with amount_cents regardless of what any later
    # webhook/status payload claims, so a manipulated or delayed webhook
    # can never credit more than what was actually quoted to the customer.
    amount_naira = Column(Float, nullable=False)
    amount_cents = Column(Integer, nullable=False)
    fx_rate_used = Column(Float, nullable=False)

    status = Column(Enum(DepositStatus), default=DepositStatus.pending, nullable=False)

    # TransactPay's own reference for this order, once known (their
    # "processorReference" field from the create-order response, if we
    # end up calling create-order server-side rather than relying solely
    # on the widget creating it -- kept nullable since the exact flow is
    # still being finalized, see transactpay_client.py notes).
    transactpay_reference = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="deposit_intents")

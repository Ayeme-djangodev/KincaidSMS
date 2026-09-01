from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


# ---------- Auth ----------

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: EmailStr
    balance_cents: int
    is_admin: bool

    class Config:
        from_attributes = True


# ---------- Wallet ----------

class DepositRequest(BaseModel):
    amount_cents: int = Field(gt=0, description="Amount to deposit, in cents")


class TransactionOut(BaseModel):
    id: int
    type: str
    amount_cents: int
    balance_after_cents: int
    description: Optional[str]
    rental_id: Optional[int]
    # TEXTVERIFIED ADDITION
    verification_id: Optional[int] = None
    # BLOOMSMS ADDITION
    activation_id: Optional[int] = None
    # TRANSACTPAY ADDITION
    deposit_intent_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- Deposits (TransactPay) ----------
# TRANSACTPAY ADDITION. Replaces the old DepositRequest stub flow.
#
# Your User model only stores email -- TransactPay's Standard Kit widget
# requires firstName/lastName/mobile too, so those are collected here at
# deposit time rather than at registration (a bigger change not made
# here). country defaults to NG given this app's Nigerian customer base.

class DepositInitiateRequest(BaseModel):
    amount_naira: float = Field(gt=0)
    country: str = "NG"


class DepositInitiateResponse(BaseModel):
    """
    Everything the frontend needs to launch TransactPay's Standard Kit
    widget directly -- the backend does NOT call TransactPay's
    create-order API itself, since the widget appears to do that
    internally using these same public credentials (see
    transactpay_client.py notes).
    """
    reference: str
    public_key: str
    encryption_key: str
    amount_naira: float
    currency: str = "NGN"
    email: str
    first_name: str
    last_name: str
    mobile: str
    country: str


class DepositVerifyResponse(BaseModel):
    status: str  # "pending" | "completed" | "failed"
    balance_cents: int
    transaction: Optional[TransactionOut] = None


# ---------- Services ----------

class ServiceOut(BaseModel):
    # TEXTVERIFIED ADDITION: which provider this row is from. Required
    # (not optional/defaulted) so the router that builds these must always
    # set it explicitly -- "getatext" or "textverified". This is how the
    # frontend distinguishes the two options for the same service name and
    # sends rentals to the right endpoint.
    provider: str

    api_name: str
    display_name: str
    base_price_cents: int          # provider's price converted to USD cents (source of truth)
    customer_price_cents: int      # base * (1 + markup), USD cents

    # NAIRA ADDITION (unchanged from before): conversion happens BEFORE
    # markup, per your instruction. Display-only; cents fields above stay
    # the accounting source of truth.
    base_price_naira: float
    customer_price_naira: float
    fx_rate_used: float

    stock: int
    multiple_sms: bool


# ---------- Rentals (Getatext) ----------

class RentNumberRequest(BaseModel):
    service: str
    carrier: Optional[str] = None
    keep_carrier: Optional[bool] = None
    lock_area_code: Optional[bool] = None
    area_codes: Optional[str] = None
    max_price_cents: Optional[int] = None
    max_price_naira: Optional[float] = None


class RentSpecificNumberRequest(BaseModel):
    number: str
    service: str
    max_price_cents: Optional[int] = None
    max_price_naira: Optional[float] = None


class RentalOut(BaseModel):
    id: int
    getatext_id: Optional[int]
    service_api_name: str
    service_display_name: Optional[str]
    number: Optional[str]
    cost_cents: int
    charged_cents: int
    status: str
    code: Optional[str]
    end_time: Optional[str]
    error_message: Optional[str]
    created_at: datetime

    cost_naira: Optional[float] = None
    charged_naira: Optional[float] = None

    class Config:
        from_attributes = True


# ---------- Verifications (TextVerified) ----------
# TEXTVERIFIED ADDITION. Deliberately separate schemas from RentNumberRequest
# / RentalOut (mirrors the separate-table decision on the model side) --
# TextVerified's request shape is simpler (no carrier/area-code options,
# capability is fixed to "sms" for this app's purposes) and its id is a
# string, not an int.

class CreateVerificationRequest(BaseModel):
    service: str
    max_price_cents: Optional[int] = None
    max_price_naira: Optional[float] = None


class VerificationOut(BaseModel):
    id: int
    textverified_id: Optional[str]
    service_api_name: str
    service_display_name: Optional[str]
    number: Optional[str]
    cost_cents: int
    charged_cents: int
    status: str
    code: Optional[str]
    error_message: Optional[str]
    created_at: datetime

    cost_naira: Optional[float] = None
    charged_naira: Optional[float] = None

    class Config:
        from_attributes = True


# ---------- Activations (BloomSMS) ----------
# BLOOMSMS ADDITION. Separate schemas mirroring the separate-table decision.
# Closest of the three providers to Getatext's shape (real cancel AND
# complete, max_price accepted directly on rent) -- so this mirrors
# RentNumberRequest/RentalOut more closely than TextVerified's schemas do.

class RentActivationRequest(BaseModel):
    service: str
    country: Optional[str] = None
    max_price_cents: Optional[int] = None
    max_price_naira: Optional[float] = None


class ActivationOut(BaseModel):
    id: int
    bloomsms_id: Optional[str]
    service_api_name: str
    service_display_name: Optional[str]
    number: Optional[str]
    cost_cents: int
    charged_cents: int
    status: str
    code: Optional[str]
    end_time: Optional[str]
    error_message: Optional[str]
    created_at: datetime

    cost_naira: Optional[float] = None
    charged_naira: Optional[float] = None

    class Config:
        from_attributes = True


# ---------- Admin ----------
# ADMIN ADDITION. Admin GET endpoints return plain dicts (with naira
# already converted server-side) rather than strict response_models --
# pragmatic choice for internal-only tooling with several ad-hoc joined
# views (user email attached to transactions/deposits, combined
# cross-provider activity, etc.) where fighting a rigid schema per view
# isn't worth it. This is the one real INPUT schema needed for validation.

class AdjustBalanceRequest(BaseModel):
    amount_naira: float  # can be negative for a debit, positive for a credit
    description: str = Field(min_length=1)

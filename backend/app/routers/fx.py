# app/routers/fx.py
#
# NAIRA ADDITION.
# Small endpoint so the frontend can do USD->NGN conversion for anything
# that isn't already converted server-side (balance_cents, wallet
# transaction history). /services and /rentals already return *_naira
# fields directly and don't need this.
#
# Register this in app/main.py the same way the other routers are
# registered, e.g.:
#
#   from app.routers import fx
#   app.include_router(fx.router)

from fastapi import APIRouter, Depends

from app import models
from app.deps import get_current_user
from app.fx import get_usd_to_ngn_rate

router = APIRouter(prefix="/fx", tags=["fx"])


@router.get("/rate")
def get_rate(current_user: models.User = Depends(get_current_user)):
    return {"usd_to_ngn": get_usd_to_ngn_rate()}

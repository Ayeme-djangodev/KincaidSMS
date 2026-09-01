import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import auth, wallet, services, rentals, verifications, activations, admin
from app.routers import fx

# SCHEMA MANAGEMENT CHANGE: Base.metadata.create_all() used to run here on
# every startup. That's removed now that Alembic owns the schema -- run
# `alembic upgrade head` once (and again after any future model change +
# `alembic revision --autogenerate`) instead of relying on auto-create.
# This is exactly the fix for the "delete reseller.db and restart" cycle
# you kept hitting.

logger = logging.getLogger("uvicorn.error")

app = FastAPI(title="SMS Reseller API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(wallet.router)
app.include_router(services.router)
app.include_router(rentals.router)
app.include_router(verifications.router)
app.include_router(activations.router)
app.include_router(admin.router)
app.include_router(fx.router)


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- RENDER DEPLOYMENT ADDITION: serve the built frontend ----------
# Combines backend + frontend into ONE Render Web Service, per your call.
# Assumes the standard repo layout this whole project has used throughout:
#     <repo root>/backend/app/main.py   (this file)
#     <repo root>/frontend/dist/        (built by `npm run build`)
#
# IMPORTANT: this block must stay at the BOTTOM of the file, after every
# app.include_router() call above. FastAPI/Starlette tries routes in the
# order they were registered -- your actual API routes (registered first)
# always get first chance to match. The catch-all route below only ever
# fires for paths that don't match anything above it, which is exactly
# the SPA-fallback behavior needed for React Router's client-side routes
# (e.g. /dashboard, /services/bloomsms) that don't correspond to real
# files -- a plain StaticFiles mount alone does NOT reliably do this
# fallback, which is why this uses an explicit catch-all instead.

FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if FRONTEND_DIST.is_dir():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        # Vite's hashed JS/CSS bundles live here -- served directly and
        # efficiently via StaticFiles, distinct from the catch-all below.
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """
        SPA catch-all. If the requested path matches a real file in
        dist/ (favicon.ico, robots.txt, etc.), serve it directly.
        Otherwise serve index.html so React Router can take over and
        render the correct client-side route -- this is what makes
        refreshing on /dashboard (or any deep link) work instead of
        404ing.
        """
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")

else:
    logger.warning(
        "frontend/dist not found at %s -- frontend will not be served, only "
        "the API. Expected locally if you haven't run `npm run build` yet; "
        "on Render, check that the build command actually built the frontend "
        "before assuming something else is wrong.",
        FRONTEND_DIST,
    )

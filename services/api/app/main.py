import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.access_log import router as access_log_router
from app.api.v1.admin import router as admin_router
from app.api.v1.auth import router as auth_router
from app.api.v1.bridge import router as bridge_router
from app.api.v1.connections import router as connections_router
from app.api.v1.journal import router as journal_router
from app.api.v1.telegram import router as telegram_router
from app.core.config import settings
from app.core.logging import RequestContextMiddleware, configure_logging
from app.core.security import hash_password
from app.db.base import SessionLocal, engine, init_db
from app.db.models import Base, Entitlement, Plan, User
from app.services.pricing_catalog import load_plans

logger = logging.getLogger(__name__)

configure_logging(settings.LOG_LEVEL)


def _seed_defaults() -> None:
    """Seed the plan catalogue and the initial admin account.

    Runs in every worker process at boot, so it must survive races:
    partial inserts are rolled back and the next attempt sees the rows that
    the winning worker committed.
    """
    plans = load_plans()
    for attempt in range(3):
        try:
            with SessionLocal() as db:
                for plan in plans:
                    row = db.get(Plan, plan.code)
                    if row is None:
                        db.add(
                            Plan(
                                code=plan.code,
                                name=plan.name,
                                max_connections=plan.max_connections,
                                price_cents=plan.price_cents,
                            )
                        )
                    else:
                        row.name = plan.name
                        row.max_connections = plan.max_connections
                        row.price_cents = plan.price_cents

                admin = db.scalar(select(User).where(User.username == settings.ADMIN_USERNAME.strip()))
                if admin is None:
                    admin = User(
                        username=settings.ADMIN_USERNAME.strip(),
                        password_hash=hash_password(settings.ADMIN_PASSWORD),
                        role="admin",
                    )
                    db.add(admin)
                    db.flush()
                    db.add(Entitlement(user_id=admin.id, plan_code="pro", max_connections=5))
                    logger.info("Seeded default admin user '%s'", admin.username)

                db.commit()
            return
        except IntegrityError:
            logger.info("Seed race detected (attempt %d), retrying", attempt + 1)
    logger.warning("Could not seed defaults after 3 attempts; continuing without them")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_runtime()

    if settings.DATABASE_URL.startswith("sqlite"):
        init_db()
    elif settings.ENVIRONMENT.lower() not in {"development", "test"}:
        # Production schema is managed by Alembic, never by create_all.
        with engine.connect() as conn:
            conn.exec_driver_sql("SELECT 1")

    _seed_defaults()
    yield


_docs_enabled = not settings.is_production

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json" if _docs_enabled else None,
    docs_url=f"{settings.API_V1_STR}/docs" if _docs_enabled else None,
    redoc_url=f"{settings.API_V1_STR}/redoc" if _docs_enabled else None,
    lifespan=lifespan,
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.trusted_hosts,
    # An API must not 307 to a www. host; a wrong Host is simply a bad request.
    www_redirect=False,
)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "PATCH"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Bridge-Token",
        "X-Connection-Id",
        "X-Request-ID",
    ],
    expose_headers=["X-Request-ID", "Retry-After"],
)

app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(access_log_router, prefix=settings.API_V1_STR)
app.include_router(admin_router, prefix=settings.API_V1_STR)
app.include_router(connections_router, prefix=settings.API_V1_STR)
app.include_router(journal_router, prefix=settings.API_V1_STR)
app.include_router(bridge_router, prefix=settings.API_V1_STR)
app.include_router(telegram_router, prefix=settings.API_V1_STR)


@app.get("/", tags=["Root"])
async def root():
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "status": "healthy",
        "mode": "read-only",
    }


@app.get("/health", tags=["Root"])
async def health():
    return {"status": "ok"}


@app.get("/ready", tags=["Root"])
def ready():
    """Readiness probe verifying database and cache connectivity."""
    status_code = status.HTTP_200_OK
    report = {
        "status": "ready",
        "database": "ok",
        "redis": "ok" if settings.REDIS_URL else "disabled",
    }

    try:
        with SessionLocal() as db:
            db.execute(select(1)).scalar()
    except Exception as exc:
        logger.error("Database readiness check failed: %s", exc)
        report["database"] = "error"
        report["status"] = "unready"
        status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    if settings.REDIS_URL:
        try:
            # Reuse the live-state backend instead of opening a new connection
            # on every probe. A memory fallback while Redis is configured means
            # workers hold divergent live state, so report it as unready.
            from app.core import live_state as _live_state

            backend = _live_state._backend
            if not isinstance(backend, _live_state._RedisBackend):
                report["redis"] = "error"
                report["status"] = "unready"
                status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            elif not backend._client.ping():
                raise RuntimeError("Redis PING returned False")
        except Exception as exc:
            logger.error("Redis readiness check failed: %s", exc)
            report["redis"] = "error"
            report["status"] = "unready"
            status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return JSONResponse(status_code=status_code, content=report)

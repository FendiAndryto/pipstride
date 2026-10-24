import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

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

logger = logging.getLogger(__name__)

configure_logging(settings.LOG_LEVEL)


def _seed_defaults() -> None:
    """Seed the plan catalogue and the initial admin account."""
    with SessionLocal() as db:
        for code, name, max_conn, price in (
            ("free", "Free", 1, 0),
            ("core", "Core", 1, 5900),
            ("plus", "Plus", 3, 12900),
            ("pro", "Pro", 5, 19900),
        ):
            if db.get(Plan, code) is None:
                db.add(Plan(code=code, name=name, max_connections=max_conn, price_cents=price))

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
async def ready():
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
            import redis

            client = redis.Redis.from_url(settings.REDIS_URL, socket_timeout=1.0)
            if not client.ping():
                report["redis"] = "error"
                report["status"] = "unready"
                status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        except Exception as exc:
            logger.error("Redis readiness check failed: %s", exc)
            report["redis"] = "error"
            report["status"] = "unready"
            status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return JSONResponse(status_code=status_code, content=report)

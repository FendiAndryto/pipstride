"""Test harness.

Environment variables are set before ``app`` is imported so that the engine,
settings and live-state backend all bind to an isolated throwaway SQLite file.
Tests never touch a developer database and never need Redis.
"""

import os
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import pyotp

_TMP_DIR = Path(tempfile.mkdtemp(prefix="pipstride-tests-"))

os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP_DIR / 'test.db').as_posix()}"
os.environ["REDIS_URL"] = ""
os.environ["SECRET_KEY"] = "test-secret-key-not-for-production"
os.environ["ADMIN_USERNAME"] = "admin"
os.environ["ADMIN_PASSWORD"] = "AdminPass123"
os.environ["ALLOWED_HOSTS"] = "*"
os.environ["TELEGRAM_NOTIFICATIONS_ENABLED"] = "false"
# Public signup is closed by default in production (SPEC-006). The suite exercises
# the registration lifecycle, so the flag is opened here and re-closed only by the
# dedicated 403 guard test.
os.environ["ENABLE_PUBLIC_REGISTRATION"] = "true"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.crypto import encrypt_secret  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.base import SessionLocal  # noqa: E402
from app.db.models import Entitlement, User  # noqa: E402
from app.main import app  # noqa: E402

TEST_PASSWORD = "Passw0rd123"

# The seeded admin always has a paired device in tests, so baseline modules that
# log in directly keep working. Un-enrolled admin/support accounts are created
# explicitly by the TOTP tests.
TEST_TOTP_SECRET = pyotp.random_base32()


def current_totp(secret: str) -> str:
    return pyotp.TOTP(secret).now()


def ensure_default_admin() -> None:
    """Make the seeded admin usable regardless of test ordering.

    ``test_reset_admin_password`` rewrites the row mid-suite, so each admin
    login repairs password, role, active state and TOTP enrollment first.
    """
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == settings.ADMIN_USERNAME))
        if user is None:
            user = User(
                username=settings.ADMIN_USERNAME,
                password_hash=hash_password(settings.ADMIN_PASSWORD),
                role="admin",
            )
            db.add(user)
            db.flush()
            db.add(Entitlement(user_id=user.id, plan_code="pro", max_connections=5))
        user.role = "admin"
        user.is_active = True
        user.password_hash = hash_password(settings.ADMIN_PASSWORD)
        user.totp_secret = encrypt_secret(TEST_TOTP_SECRET)
        user.totp_enrolled_at = datetime.now(timezone.utc)
        db.commit()


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session", autouse=True)
def _default_admin_is_enrolled(client):
    ensure_default_admin()
    yield


@pytest.fixture
def account(client):
    """A fresh registered user with a bearer token."""
    username = f"user_{uuid.uuid4().hex[:10]}"
    res = client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": TEST_PASSWORD},
    )
    assert res.status_code == 201, res.text

    body = res.json()
    return {
        "username": username,
        "password": TEST_PASSWORD,
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


@pytest.fixture
def admin_headers(client):
    ensure_default_admin()
    res = client.post(
        "/api/v1/auth/login",
        json={
            "username": settings.ADMIN_USERNAME,
            "password": settings.ADMIN_PASSWORD,
            "totp_code": current_totp(TEST_TOTP_SECRET),
        },
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture
def make_user():
    """Factory for role-specific accounts, enrolled in TOTP on demand."""

    def _make(
        role: str = "trader",
        *,
        username: str | None = None,
        password: str = TEST_PASSWORD,
        enrolled: bool = False,
        active: bool = True,
    ) -> dict:
        name = username or f"{role}_{uuid.uuid4().hex[:10]}"
        secret = pyotp.random_base32()
        with SessionLocal() as db:
            user = User(
                username=name,
                password_hash=hash_password(password),
                role=role,
                is_active=active,
                totp_secret=encrypt_secret(secret) if enrolled else None,
                totp_enrolled_at=datetime.now(timezone.utc) if enrolled else None,
            )
            db.add(user)
            db.flush()
            db.add(Entitlement(user_id=user.id, plan_code="free", max_connections=1))
            db.commit()
            user_id = user.id
        return {
            "id": user_id,
            "username": name,
            "password": password,
            "secret": secret if enrolled else None,
        }

    return _make


def grant_connections(username: str, limit: int) -> None:
    """Raise a user's connection quota for multi-account tests."""
    with SessionLocal() as db:
        from sqlalchemy import select

        from app.db.models import User

        user = db.scalar(select(User).where(User.username == username))
        assert user is not None
        entitlement = db.get(Entitlement, user.id)
        assert entitlement is not None
        entitlement.max_connections = limit
        db.commit()


def heartbeat_payload(account_number: int, **overrides) -> dict:
    payload = {
        "account_number": account_number,
        "server": "Pipstride-Demo",
        "currency": "USD",
        "balance": 10_500.0,
        "equity": 10_450.0,
        "initial_deposit": 10_000.0,
        "margin": 200.0,
        "free_margin": 10_250.0,
        "margin_level": 5225.0,
        "floating_pnl": -50.0,
        "terminal_connected": True,
        "open_positions": 1,
        "positions": [
            {
                "ticket": 9001,
                "symbol": "EURUSD",
                "type": "BUY",
                "volume": 0.10,
                "open_price": 1.0850,
                "current_price": 1.0845,
                "pnl": -5.0,
                "open_time": 1_700_000_000,
            }
        ],
        "market_quotes": [
            {"symbol": "EURUSD", "bid": 1.0845, "ask": 1.0846, "spread": 10, "digits": 5}
        ],
        "closed_trades": [
            {
                "ticket": 5001,
                "symbol": "EURUSD",
                "type": "BUY",
                "volume": 0.10,
                "open_price": 1.0800,
                "close_price": 1.0850,
                "profit": 50.0,
                "open_time": 1_699_000_000,
                "close_time": 1_699_500_000,
            },
            {
                "ticket": 5002,
                "symbol": "XAUUSD",
                "type": "SELL",
                "volume": 0.01,
                "open_price": 2400.0,
                "close_price": 2405.0,
                "profit": -20.0,
                "open_time": 1_699_600_000,
                "close_time": 1_699_900_000,
            },
        ],
        "chart_symbol": "EURUSD",
        # Both clocks must be "now": the API derives the broker clock offset
        # from `broker_time` (TimeCurrent) minus its own UTC clock, so a frozen
        # past timestamp would be clamped to the +-14h limit and move the broker
        # day boundary. `timestamp` is the terminal's local clock and is
        # deliberately kept separate (spec 003, ticket 09-01).
        "timestamp": int(time.time()),
        "broker_time": int(time.time()),
    }
    payload.update(overrides)
    return payload

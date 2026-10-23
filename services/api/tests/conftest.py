"""Test harness.

Environment variables are set before ``app`` is imported so that the engine,
settings and live-state backend all bind to an isolated throwaway SQLite file.
Tests never touch a developer database and never need Redis.
"""

import os
import tempfile
import uuid
from pathlib import Path

import pytest

_TMP_DIR = Path(tempfile.mkdtemp(prefix="pipstride-tests-"))

os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP_DIR / 'test.db').as_posix()}"
os.environ["REDIS_URL"] = ""
os.environ["SECRET_KEY"] = "test-secret-key-not-for-production"
os.environ["ADMIN_USERNAME"] = "admin"
os.environ["ADMIN_PASSWORD"] = "AdminPass123"
os.environ["ALLOWED_HOSTS"] = "*"
os.environ["TELEGRAM_NOTIFICATIONS_ENABLED"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.base import SessionLocal  # noqa: E402
from app.db.models import Entitlement  # noqa: E402
from app.main import app  # noqa: E402

TEST_PASSWORD = "Passw0rd123"


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client


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
    res = client.post(
        "/api/v1/auth/login",
        json={"username": settings.ADMIN_USERNAME, "password": settings.ADMIN_PASSWORD},
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


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
        "timestamp": 1_700_000_100,
    }
    payload.update(overrides)
    return payload

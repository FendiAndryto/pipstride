"""Tests for user account expiration and trial period policies (SPEC-004, Ticket 01)."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.base import SessionLocal
from app.db.models import User
from app.domain.policies import is_account_active
from app.domain.time import as_utc
from tests.conftest import TEST_PASSWORD, heartbeat_payload


def _set_user_state(username: str, *, expires_at=None, is_active=True):
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == username))
        assert user is not None
        user.expires_at = expires_at
        user.is_active = is_active
        db.commit()


def test_is_account_active_unit():
    now = datetime(2026, 11, 13, 12, 0, 0, tzinfo=timezone.utc)

    # Inactive always False
    assert is_account_active(False, None, now=now) is False
    assert (
        is_account_active(
            False, now + timedelta(days=1), now=now
        )
        is False
    )

    # Lifetime (None) is active
    assert is_account_active(True, None, now=now) is True

    # Future expiry is active
    future = now + timedelta(days=5)
    assert is_account_active(True, future, now=now) is True

    # Past expiry is inactive
    past = now - timedelta(days=1)
    assert is_account_active(True, past, now=now) is False

    # Exact same second is inactive (must be strictly > now)
    assert is_account_active(True, now, now=now) is False

    # Naive datetime from SQLite should be safely handled via as_utc
    naive_future = datetime(2026, 11, 14, 12, 0, 0)
    assert is_account_active(True, naive_future, now=now) is True
    naive_past = datetime(2026, 11, 12, 12, 0, 0)
    assert is_account_active(True, naive_past, now=now) is False


def test_login_success_with_future_expiry(client, make_user):
    user_data = make_user()
    _set_user_state(
        user_data["username"],
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )

    res = client.post(
        "/api/v1/auth/login",
        json={"username": user_data["username"], "password": TEST_PASSWORD},
    )
    assert res.status_code == 200, res.text
    assert "access_token" in res.json()


def test_login_success_with_lifetime_expiry(client, make_user):
    user_data = make_user()
    _set_user_state(user_data["username"], expires_at=None)

    res = client.post(
        "/api/v1/auth/login",
        json={"username": user_data["username"], "password": TEST_PASSWORD},
    )
    assert res.status_code == 200, res.text
    assert "access_token" in res.json()


def test_login_rejected_with_past_expiry(client, make_user):
    user_data = make_user()
    _set_user_state(
        user_data["username"],
        expires_at=datetime.now(timezone.utc) - timedelta(days=1),
    )

    res = client.post(
        "/api/v1/auth/login",
        json={"username": user_data["username"], "password": TEST_PASSWORD},
    )
    assert res.status_code == 403, res.text
    assert "Masa aktif akun telah berakhir" in res.json()["detail"]


def test_login_rejected_wrong_password_even_if_expired(client, make_user):
    user_data = make_user()
    _set_user_state(
        user_data["username"],
        expires_at=datetime.now(timezone.utc) - timedelta(days=1),
    )

    res = client.post(
        "/api/v1/auth/login",
        json={"username": user_data["username"], "password": "WrongPassword999!"},
    )
    # Anti-enumeration: wrong password gives 401, not 403
    assert res.status_code == 401
    assert "Invalid username or password" in res.json()["detail"]


def test_login_rejected_inactive_account(client, make_user):
    user_data = make_user(active=False)

    res = client.post(
        "/api/v1/auth/login",
        json={"username": user_data["username"], "password": TEST_PASSWORD},
    )
    # Anti-enumeration: inactive user returns 401
    assert res.status_code == 401
    assert "Invalid username or password" in res.json()["detail"]


def test_session_token_rejected_after_expiry_passes(client, make_user):
    """AC #4: Token JWT issued when active is rejected after expires_at passes."""
    user_data = make_user()
    _set_user_state(
        user_data["username"],
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )

    # 1. Login to get a valid token
    res = client.post(
        "/api/v1/auth/login",
        json={"username": user_data["username"], "password": TEST_PASSWORD},
    )
    assert res.status_code == 200
    token = res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Token works initially
    res_me = client.get("/api/v1/auth/me", headers=headers)
    assert res_me.status_code == 200

    # 3. Time passes: fast-forward user.expires_at to the past
    _set_user_state(
        user_data["username"],
        expires_at=datetime.now(timezone.utc) - timedelta(seconds=10),
    )

    # 4. Same token is now rejected with 401
    res_expired = client.get("/api/v1/auth/me", headers=headers)
    assert res_expired.status_code == 401
    assert "Session expired: account has expired" in res_expired.json()["detail"]


def test_session_token_rejected_when_deactivated(client, make_user):
    user_data = make_user()
    res = client.post(
        "/api/v1/auth/login",
        json={"username": user_data["username"], "password": TEST_PASSWORD},
    )
    token = res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Deactivate account
    _set_user_state(user_data["username"], is_active=False)

    res_deactivated = client.get("/api/v1/auth/me", headers=headers)
    assert res_deactivated.status_code == 401
    assert "User not recognized or account deactivated" in res_deactivated.json()["detail"]


def test_self_registration_assigns_trial_days(client):
    username = f"trader_{uuid.uuid4().hex[:8]}"
    before = datetime.now(timezone.utc)
    res = client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": TEST_PASSWORD},
    )
    after = datetime.now(timezone.utc)
    assert res.status_code == 201

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == username))
        assert user is not None
        assert user.expires_at is not None

        user_exp = as_utc(user.expires_at)
        expected_min = before + timedelta(days=settings.DEFAULT_REGISTRATION_TRIAL_DAYS)
        expected_max = after + timedelta(days=settings.DEFAULT_REGISTRATION_TRIAL_DAYS)
        assert expected_min <= user_exp <= expected_max


def _create_test_connection(client, account):
    res = client.post(
        "/api/v1/connections",
        params={"label": "Test EA"},
        headers=account["headers"],
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_bridge_heartbeat_rejected_when_owner_expired(client, account):
    conn = _create_test_connection(client, account)
    token = conn["token"]
    payload = heartbeat_payload(123456)

    # 1. Heartbeat works while active
    res_ok = client.post(
        "/api/v1/bridge/heartbeat",
        json=payload,
        headers={"X-Bridge-Token": token},
    )
    assert res_ok.status_code == 200

    # 2. Expire account
    _set_user_state(
        account["username"],
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )

    # 3. Heartbeat rejected with 403
    res_err = client.post(
        "/api/v1/bridge/heartbeat",
        json=payload,
        headers={"X-Bridge-Token": token},
    )
    assert res_err.status_code == 403
    assert "Account is inactive or has expired" in res_err.json()["detail"]


def test_bridge_heartbeat_rejected_when_owner_inactive(client, account):
    conn = _create_test_connection(client, account)
    token = conn["token"]
    payload = heartbeat_payload(123456)

    # Deactivate account
    _set_user_state(account["username"], is_active=False)

    res_err = client.post(
        "/api/v1/bridge/heartbeat",
        json=payload,
        headers={"X-Bridge-Token": token},
    )
    assert res_err.status_code == 403
    assert "Account is inactive or has expired" in res_err.json()["detail"]


def test_bridge_sync_trades_rejected_when_owner_expired(client, account):
    conn = _create_test_connection(client, account)
    token = conn["token"]

    payload = {
        "account_number": None,
        "closed_trades": [],
    }

    # Expire account
    _set_user_state(
        account["username"],
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )

    res_err = client.post(
        "/api/v1/bridge/sync-trades",
        json=payload,
        headers={"X-Bridge-Token": token},
    )
    assert res_err.status_code == 403
    assert "Account is inactive or has expired" in res_err.json()["detail"]


def test_bridge_sync_trades_rejected_when_owner_inactive(client, account):
    conn = _create_test_connection(client, account)
    token = conn["token"]

    payload = {
        "account_number": None,
        "closed_trades": [],
    }

    # Deactivate account
    _set_user_state(account["username"], is_active=False)

    res_err = client.post(
        "/api/v1/bridge/sync-trades",
        json=payload,
        headers={"X-Bridge-Token": token},
    )
    assert res_err.status_code == 403
    assert "Account is inactive or has expired" in res_err.json()["detail"]

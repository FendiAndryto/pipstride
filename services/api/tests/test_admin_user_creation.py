"""Tests for admin user creation and expiration management (SPEC-004, Ticket 02)."""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pyotp
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.base import SessionLocal
from app.db.models import AuditLog, Entitlement, User
from app.domain.time import as_utc


def _audit_rows(action: str, target_user_id: str | None = None) -> list[AuditLog]:
    with SessionLocal() as db:
        stmt = select(AuditLog).where(AuditLog.action == action)
        if target_user_id is not None:
            stmt = stmt.where(AuditLog.target_user_id == target_user_id)
        return list(db.scalars(stmt.order_by(AuditLog.id)))


def _admin_id() -> str:
    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.username == settings.ADMIN_USERNAME))
        assert admin is not None
        return admin.id


def test_admin_create_user_success_audited(client, admin_headers):
    username = f"trader_{uuid.uuid4().hex[:8]}"
    payload = {
        "username": username,
        "password": "ValidPassword123!",
        "email": f"{username}@example.com",
        "role": "trader",
        "plan_code": "core",
        "duration_days": 30,
    }

    res = client.post(
        "/api/v1/admin/users",
        json=payload,
        headers=admin_headers,
    )
    assert res.status_code == 201, res.text
    data = res.json()

    # Response is metadata-only
    assert data["username"] == username
    assert data["email"] == f"{username}@example.com"
    assert data["role"] == "trader"
    assert data["plan_code"] == "core"
    assert data["max_connections"] == 1
    assert data["is_active"] is True
    assert data["is_expired"] is False
    assert "password" not in data
    assert "password_hash" not in data
    assert data["expires_at"] is not None

    user_id = data["id"]

    # Verify Entitlement in DB
    with SessionLocal() as db:
        ent = db.get(Entitlement, user_id)
        assert ent is not None
        assert ent.plan_code == "core"
        assert ent.max_connections == 1

        created_user = db.get(User, user_id)
        assert created_user is not None
        exp = as_utc(created_user.expires_at)
        assert exp is not None
        diff = (exp - datetime.now(timezone.utc)).total_seconds()
        assert 29 * 86400 < diff <= 30 * 86400 + 10

    # Verify AuditLog
    logs = _audit_rows("admin.user.created", target_user_id=user_id)
    assert len(logs) == 1
    log = logs[0]
    assert log.user_id == _admin_id()
    assert log.target_user_id == user_id
    assert "ValidPassword123!" not in (log.detail or "")
    assert "plan=core" in (log.detail or "")


def test_admin_create_user_lifetime(client, admin_headers):
    username = f"trader_{uuid.uuid4().hex[:8]}"
    payload = {
        "username": username,
        "password": "ValidPassword123!",
        "set_lifetime": True,
        "plan_code": "pro",
    }

    res = client.post(
        "/api/v1/admin/users",
        json=payload,
        headers=admin_headers,
    )
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["plan_code"] == "pro"
    assert data["max_connections"] == 5
    assert data["expires_at"] is None
    assert data["is_expired"] is False


def test_admin_create_user_exact_expires_at(client, admin_headers):
    username = f"trader_{uuid.uuid4().hex[:8]}"
    target_dt = datetime.now(timezone.utc) + timedelta(days=45)
    payload = {
        "username": username,
        "password": "ValidPassword123!",
        "exact_expires_at": target_dt.isoformat(),
    }

    res = client.post(
        "/api/v1/admin/users",
        json=payload,
        headers=admin_headers,
    )
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["expires_at"] is not None
    assert data["is_expired"] is False


def test_admin_create_user_atomic_rollback(client, admin_headers):
    """If audit fails, user and entitlement must be rolled back."""
    username = f"trader_{uuid.uuid4().hex[:8]}"
    payload = {
        "username": username,
        "password": "ValidPassword123!",
        "duration_days": 14,
    }

    with patch("app.services.admin_service._audit", side_effect=RuntimeError("Audit DB Error")):
        with pytest.raises(RuntimeError, match="Audit DB Error"):
            client.post(
                "/api/v1/admin/users",
                json=payload,
                headers=admin_headers,
            )

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == username))
        assert user is None


def test_admin_create_user_duplicate_username_409(client, admin_headers):
    username = f"trader_{uuid.uuid4().hex[:8]}"
    payload = {
        "username": username,
        "password": "ValidPassword123!",
        "duration_days": 7,
    }

    # First attempt: success
    res1 = client.post("/api/v1/admin/users", json=payload, headers=admin_headers)
    assert res1.status_code == 201

    # Second attempt: 409 Conflict
    res2 = client.post("/api/v1/admin/users", json=payload, headers=admin_headers)
    assert res2.status_code == 409
    assert "already registered" in res2.json()["detail"]


def test_admin_create_user_validations(client, admin_headers):
    # 1. Invalid username
    res = client.post(
        "/api/v1/admin/users",
        json={"username": "ab", "password": "ValidPassword123!", "duration_days": 7},
        headers=admin_headers,
    )
    assert res.status_code == 422  # Pydantic min_length=3

    # 2. Password without numbers
    res = client.post(
        "/api/v1/admin/users",
        json={
            "username": f"user_{uuid.uuid4().hex[:6]}",
            "password": "OnlyLettersPassword",
            "duration_days": 7,
        },
        headers=admin_headers,
    )
    assert res.status_code == 400
    assert "Password must contain at least one number" in res.json()["detail"]

    # 3. Role other than trader is rejected by Pydantic Literal
    res = client.post(
        "/api/v1/admin/users",
        json={
            "username": f"user_{uuid.uuid4().hex[:6]}",
            "password": "ValidPassword123!",
            "role": "admin",
            "duration_days": 7,
        },
        headers=admin_headers,
    )
    assert res.status_code == 422

    # 4. Unknown plan
    res = client.post(
        "/api/v1/admin/users",
        json={
            "username": f"user_{uuid.uuid4().hex[:6]}",
            "password": "ValidPassword123!",
            "plan_code": "mega_vip",
            "duration_days": 7,
        },
        headers=admin_headers,
    )
    assert res.status_code == 400
    assert "Unknown plan code" in res.json()["detail"]

    # 5. Naive exact_expires_at rejected by validator
    res = client.post(
        "/api/v1/admin/users",
        json={
            "username": f"user_{uuid.uuid4().hex[:6]}",
            "password": "ValidPassword123!",
            "exact_expires_at": "2027-01-01T12:00:00",  # naive, no offset
        },
        headers=admin_headers,
    )
    assert res.status_code == 422
    assert "must be timezone-aware" in str(res.json())

    # 6. All duration options omitted
    res = client.post(
        "/api/v1/admin/users",
        json={
            "username": f"user_{uuid.uuid4().hex[:6]}",
            "password": "ValidPassword123!",
        },
        headers=admin_headers,
    )
    assert res.status_code == 400
    assert "Provide duration_days, exact_expires_at, or set_lifetime" in res.json()["detail"]


def test_non_admin_cannot_create_user(client, make_user):
    support_user = make_user(role="support", enrolled=True)
    login_res = client.post(
        "/api/v1/auth/login",
        json={
            "username": support_user["username"],
            "password": support_user["password"],
            "totp_code": pyotp.TOTP(support_user["secret"]).now(),
        },
    )
    assert login_res.status_code == 200
    support_headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

    res = client.post(
        "/api/v1/admin/users",
        json={
            "username": f"trader_{uuid.uuid4().hex[:8]}",
            "password": "ValidPassword123!",
            "duration_days": 30,
        },
        headers=support_headers,
    )
    assert res.status_code == 403


def test_admin_extend_expiry(client, admin_headers, make_user):
    user_data = make_user()
    user_id = user_data["id"]
    fixed_now = datetime(2026, 11, 13, 12, 0, 0, tzinfo=timezone.utc)

    # 1. Set user to expire 2 days from now
    with SessionLocal() as db:
        user = db.get(User, user_id)
        user.expires_at = fixed_now + timedelta(days=2)
        db.commit()

    # 2. Extend by 30 days while still active (with deterministic now)
    with patch("app.services.admin_service.datetime") as mock_dt:
        mock_dt.now.return_value = fixed_now
        mock_dt.side_effect = lambda *args, **kw: datetime(*args, **kw)
        res = client.post(
            f"/api/v1/admin/users/{user_id}/extend-expiry",
            json={"duration_days": 30},
            headers=admin_headers,
        )
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["expires_at"] is not None

        with SessionLocal() as db:
            updated = db.get(User, user_id)
            exp = as_utc(updated.expires_at)
            # Should add 30 days to existing 2 days -> 32 days from fixed_now
            expected = fixed_now + timedelta(days=32)
            assert abs((exp - expected).total_seconds()) < 2

    # 3. Extend when already expired -> adds from now
    with SessionLocal() as db:
        user = db.get(User, user_id)
        user.expires_at = fixed_now - timedelta(days=5)
        db.commit()

    with patch("app.services.admin_service.datetime") as mock_dt:
        mock_dt.now.return_value = fixed_now
        mock_dt.side_effect = lambda *args, **kw: datetime(*args, **kw)
        res = client.post(
            f"/api/v1/admin/users/{user_id}/extend-expiry",
            json={"duration_days": 7},
            headers=admin_headers,
        )
        assert res.status_code == 200
        with SessionLocal() as db:
            updated = db.get(User, user_id)
            exp = as_utc(updated.expires_at)
            expected = fixed_now + timedelta(days=7)
            assert abs((exp - expected).total_seconds()) < 2

    # 4. Set lifetime
    res = client.post(
        f"/api/v1/admin/users/{user_id}/extend-expiry",
        json={"set_lifetime": True},
        headers=admin_headers,
    )
    assert res.status_code == 200
    assert res.json()["expires_at"] is None

    # Verify audit logs
    logs = _audit_rows("admin.user.expiry_updated", target_user_id=user_id)
    assert len(logs) == 3


def test_is_expired_projection_in_list_and_detail(client, admin_headers, make_user):
    """Test is_expired field in GET /admin/users and GET /admin/users/{id}."""
    active_user = make_user()
    with SessionLocal() as db:
        u = db.get(User, active_user["id"])
        u.expires_at = datetime.now(timezone.utc) + timedelta(days=10)
        db.commit()

    expired_user = make_user()
    with SessionLocal() as db:
        u = db.get(User, expired_user["id"])
        u.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        db.commit()

    lifetime_user = make_user()
    with SessionLocal() as db:
        u = db.get(User, lifetime_user["id"])
        u.expires_at = None
        db.commit()

    # Detail check
    res_active = client.get(f"/api/v1/admin/users/{active_user['id']}", headers=admin_headers)
    assert res_active.status_code == 200
    assert res_active.json()["is_expired"] is False

    res_expired = client.get(f"/api/v1/admin/users/{expired_user['id']}", headers=admin_headers)
    assert res_expired.status_code == 200
    assert res_expired.json()["is_expired"] is True

    res_lifetime = client.get(f"/api/v1/admin/users/{lifetime_user['id']}", headers=admin_headers)
    assert res_lifetime.status_code == 200
    assert res_lifetime.json()["is_expired"] is False

    # List check
    res_list = client.get(f"/api/v1/admin/users?search={expired_user['username']}", headers=admin_headers)
    assert res_list.status_code == 200
    items = res_list.json()["items"]
    assert len(items) == 1
    assert items[0]["is_expired"] is True

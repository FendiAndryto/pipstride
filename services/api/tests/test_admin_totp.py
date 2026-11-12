"""Mandatory TOTP for admin/support accounts (ADR 0008 §5)."""

import pyotp
from sqlalchemy import select

from app.core.crypto import decrypt_secret
from app.db.base import SessionLocal
from app.db.models import User
from tests.conftest import current_totp


def test_admin_without_totp_cannot_log_in(client, make_user):
    admin = make_user("admin", enrolled=False)
    res = client.post(
        "/api/v1/auth/login",
        json={"username": admin["username"], "password": admin["password"]},
    )
    assert res.status_code == 403
    assert "Two-factor enrollment required" in res.json()["detail"]


def test_trader_login_stays_single_factor(client, make_user):
    trader = make_user("trader")
    res = client.post(
        "/api/v1/auth/login",
        json={"username": trader["username"], "password": trader["password"]},
    )
    assert res.status_code == 200
    assert res.json()["totp_enrolled"] is False


def test_enrollment_flow_unlocks_login(client, make_user):
    admin = make_user("admin", enrolled=False)

    start = client.post(
        "/api/v1/auth/totp/enroll/start",
        json={"username": admin["username"], "password": admin["password"]},
    )
    assert start.status_code == 200, start.text
    body = start.json()
    secret = body["secret"]
    assert body["otpauth_uri"].startswith("otpauth://totp/")

    verify = client.post(
        "/api/v1/auth/totp/enroll/verify",
        json={
            "username": admin["username"],
            "password": admin["password"],
            "code": pyotp.TOTP(secret).now(),
        },
    )
    assert verify.status_code == 200, verify.text
    assert verify.json()["enrolled_at"]

    # The same password now needs the second factor.
    missing = client.post(
        "/api/v1/auth/login",
        json={"username": admin["username"], "password": admin["password"]},
    )
    assert missing.status_code == 401

    ok = client.post(
        "/api/v1/auth/login",
        json={
            "username": admin["username"],
            "password": admin["password"],
            "totp_code": current_totp(secret),
        },
    )
    assert ok.status_code == 200
    assert ok.json()["totp_enrolled"] is True

    wrong = client.post(
        "/api/v1/auth/login",
        json={
            "username": admin["username"],
            "password": admin["password"],
            "totp_code": "000000",
        },
    )
    assert wrong.status_code == 401


def test_seed_is_encrypted_at_rest(client, make_user):
    admin = make_user("admin", enrolled=False)
    start = client.post(
        "/api/v1/auth/totp/enroll/start",
        json={"username": admin["username"], "password": admin["password"]},
    )
    secret = start.json()["secret"]

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.id == admin["id"]))
        stored = user.totp_secret

    assert stored and stored != secret
    assert decrypt_secret(stored) == secret


def test_enrolling_twice_is_rejected(client, make_user):
    admin = make_user("admin", enrolled=True)
    res = client.post(
        "/api/v1/auth/totp/enroll/start",
        json={"username": admin["username"], "password": admin["password"]},
    )
    assert res.status_code == 409


def test_enrollment_rejects_non_privileged_accounts(client, make_user):
    trader = make_user("trader")
    res = client.post(
        "/api/v1/auth/totp/enroll/start",
        json={"username": trader["username"], "password": trader["password"]},
    )
    assert res.status_code == 400


def test_enrollment_requires_the_right_password(client, make_user):
    admin = make_user("admin", enrolled=False)
    res = client.post(
        "/api/v1/auth/totp/enroll/start",
        json={"username": admin["username"], "password": "wrong-password"},
    )
    assert res.status_code == 401

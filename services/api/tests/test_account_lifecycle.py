"""Account lifecycle: email capture, verification and password recovery.

Emails are never actually sent; the single seam (``email_service.send``) is
patched so the tests can read the link a user would have received.
"""

import re
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core import rate_limit
from app.db.base import SessionLocal
from app.db.models import User
from app.services import email_service as email_module
from app.services.auth_token_service import PURPOSE_RESET, auth_token_service

TEST_PASSWORD = "Passw0rd123"
NEW_PASSWORD = "NewPassw0rd456"

FORGOT_KEY = "forgot:testclient"


@pytest.fixture
def outbox(monkeypatch):
    messages = []

    def fake_send(to, subject, body):
        messages.append({"to": to, "subject": subject, "body": body})
        return True

    monkeypatch.setattr(email_module.email_service, "send", fake_send)
    rate_limit.clear(FORGOT_KEY)
    yield messages
    rate_limit.clear(FORGOT_KEY)


def register(client, email=None, password=TEST_PASSWORD):
    username = f"life_{uuid.uuid4().hex[:10]}"
    payload = {"username": username, "password": password}
    if email is not None:
        payload["email"] = email
    res = client.post("/api/v1/auth/register", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    return {
        "username": username,
        "password": password,
        "email": email,
        "token": body["access_token"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


def token_from(body: str, param: str) -> str:
    match = re.search(rf"{param}=([A-Za-z0-9_\-]+)", body)
    assert match, f"no {param} in email body: {body}"
    return match.group(1)


def test_register_stores_normalized_email(client, outbox):
    account = register(client, email="  Trader@Example.COM ")

    res = client.get("/api/v1/auth/me", headers=account["headers"])
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == "trader@example.com"
    assert body["email_verified"] is False

    assert len(outbox) == 1
    assert outbox[0]["to"] == "trader@example.com"
    assert "?verify_email=" in outbox[0]["body"]


def test_duplicate_email_is_rejected_case_insensitively(client, outbox):
    email = f"dup_{uuid.uuid4().hex[:8]}@example.com"
    register(client, email=email)

    res = client.post(
        "/api/v1/auth/register",
        json={
            "username": f"life_{uuid.uuid4().hex[:10]}",
            "password": TEST_PASSWORD,
            "email": email.upper(),
        },
    )
    assert res.status_code == 409, res.text
    assert "already registered" in res.json()["detail"].lower()


def test_invalid_email_on_register_is_rejected(client, outbox):
    res = client.post(
        "/api/v1/auth/register",
        json={
            "username": f"life_{uuid.uuid4().hex[:10]}",
            "password": TEST_PASSWORD,
            "email": "not-an-email",
        },
    )
    assert res.status_code == 400, res.text


def test_forgot_password_does_not_reveal_whether_account_exists(client, outbox):
    known = register(client, email=f"known_{uuid.uuid4().hex[:8]}@example.com")
    outbox.clear()

    unknown = client.post(
        "/api/v1/auth/forgot-password", json={"email": f"ghost_{uuid.uuid4().hex[:8]}@example.com"}
    )
    found = client.post("/api/v1/auth/forgot-password", json={"email": known["email"]})

    assert unknown.status_code == 202
    assert found.status_code == 202
    assert unknown.json()["message"] == found.json()["message"]

    # Only the real account triggers a message.
    assert len(outbox) == 1
    assert outbox[0]["to"] == known["email"]
    assert "?reset_token=" in outbox[0]["body"]


def test_forgot_password_ignores_malformed_email(client, outbox):
    res = client.post("/api/v1/auth/forgot-password", json={"email": "still-not-an-email"})
    assert res.status_code == 202
    assert outbox == []


def test_reset_password_rotates_password_and_revokes_sessions(client, outbox):
    account = register(client, email=f"reset_{uuid.uuid4().hex[:8]}@example.com")

    res = client.post("/api/v1/auth/forgot-password", json={"email": account["email"]})
    assert res.status_code == 202
    raw_token = token_from(outbox[-1]["body"], "reset_token")

    res = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": NEW_PASSWORD},
    )
    assert res.status_code == 200, res.text

    # Every session issued before the reset is revoked.
    assert client.get("/api/v1/auth/me", headers=account["headers"]).status_code == 401

    old_login = client.post(
        "/api/v1/auth/login",
        json={"username": account["username"], "password": TEST_PASSWORD},
    )
    assert old_login.status_code == 401

    new_login = client.post(
        "/api/v1/auth/login",
        json={"username": account["username"], "password": NEW_PASSWORD},
    )
    assert new_login.status_code == 200, new_login.text

    # A reset link is single use.
    replay = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": "AnotherPass123"},
    )
    assert replay.status_code == 400


def test_weak_reset_password_does_not_burn_the_link(client, outbox):
    account = register(client, email=f"weak_{uuid.uuid4().hex[:8]}@example.com")
    client.post("/api/v1/auth/forgot-password", json={"email": account["email"]})
    raw_token = token_from(outbox[-1]["body"], "reset_token")

    weak = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": "onlyletters"},
    )
    assert weak.status_code == 400

    good = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": NEW_PASSWORD},
    )
    assert good.status_code == 200, good.text


def test_expired_reset_token_is_rejected(client, outbox):
    account = register(client, email=f"expired_{uuid.uuid4().hex[:8]}@example.com")

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == account["username"]))
        assert user is not None
        expired = auth_token_service.issue(
            db, user, PURPOSE_RESET, timedelta(minutes=-1)
        )

    res = client.post(
        "/api/v1/auth/reset-password",
        json={"token": expired, "new_password": NEW_PASSWORD},
    )
    assert res.status_code == 400


def test_verify_email_flow(client, outbox):
    account = register(client, email=f"verify_{uuid.uuid4().hex[:8]}@example.com")
    raw_token = token_from(outbox[-1]["body"], "verify_email")

    assert client.get("/api/v1/auth/me", headers=account["headers"]).json()["email_verified"] is False

    res = client.post("/api/v1/auth/verify-email", json={"token": raw_token})
    assert res.status_code == 200, res.text
    assert res.json()["email_verified"] is True

    me = client.get("/api/v1/auth/me", headers=account["headers"]).json()
    assert me["email_verified"] is True

    # Single use.
    replay = client.post("/api/v1/auth/verify-email", json={"token": raw_token})
    assert replay.status_code == 400


def test_set_email_requires_auth_and_rejects_duplicates(client, outbox):
    owner = register(client, email=f"owner_{uuid.uuid4().hex[:8]}@example.com")
    other = register(client, email=f"other_{uuid.uuid4().hex[:8]}@example.com")

    anonymous = client.post("/api/v1/auth/email", json={"email": "anon@example.com"})
    assert anonymous.status_code == 401

    taken = client.post(
        "/api/v1/auth/email",
        json={"email": owner["email"].upper()},
        headers=other["headers"],
    )
    assert taken.status_code == 409, taken.text

    new_email = f"changed_{uuid.uuid4().hex[:8]}@example.com"
    outbox.clear()
    changed = client.post(
        "/api/v1/auth/email", json={"email": new_email}, headers=other["headers"]
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["email"] == new_email
    assert changed.json()["email_verified"] is False
    assert len(outbox) == 1
    assert "?verify_email=" in outbox[0]["body"]

    # Changing the address invalidates the old verification.
    me = client.get("/api/v1/auth/me", headers=other["headers"]).json()
    assert me["email"] == new_email
    assert me["email_verified"] is False


def test_forgot_password_is_rate_limited_per_ip(client, outbox):
    try:
        statuses = []
        for _ in range(6):
            res = client.post(
                "/api/v1/auth/forgot-password",
                json={"email": f"ghost_{uuid.uuid4().hex[:8]}@example.com"},
            )
            statuses.append(res.status_code)
        assert statuses[:5] == [202] * 5
        assert statuses[5] == 429
    finally:
        rate_limit.clear(FORGOT_KEY)

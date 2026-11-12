"""Support mode: time-boxed elevation, visible to the affected user (ADR 0008 §6)."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.config import settings
from app.db.base import SessionLocal
from app.db.models import AccountSettings, AuditLog, SupportSession, Trade
from tests.conftest import current_totp


def _login(client, user: dict) -> dict:
    payload = {"username": user["username"], "password": user["password"]}
    if user.get("secret"):
        payload["totp_code"] = current_totp(user["secret"])
    res = client.post("/api/v1/auth/login", json=payload)
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _audit_count(action: str, target_user_id: str) -> int:
    with SessionLocal() as db:
        return len(
            list(
                db.scalars(
                    select(AuditLog).where(
                        AuditLog.action == action,
                        AuditLog.target_user_id == target_user_id,
                    )
                )
            )
        )


def test_support_mode_is_disabled_by_default(client, make_user, monkeypatch):
    monkeypatch.setattr(settings, "SUPPORT_MODE_ENABLED", False)
    support = make_user("support", enrolled=True)
    target = make_user("trader")

    res = client.post(
        "/api/v1/admin/support/sessions",
        json={"target_user_id": target["id"], "reason": "investigate ticket"},
        headers=_login(client, support),
    )
    assert res.status_code == 403
    assert "disabled" in res.json()["detail"].lower()


def test_support_flow_grant_view_revoke(client, account, make_user, monkeypatch):
    monkeypatch.setattr(settings, "SUPPORT_MODE_ENABLED", True)

    support = make_user("support", enrolled=True)
    support_headers = _login(client, support)

    from app.db.base import SessionLocal as _Session

    with _Session() as db:
        from app.db.models import User

        target = db.scalar(select(User).where(User.username == account["username"]))
        target_id = target.id

    connection = client.post("/api/v1/connections", headers=account["headers"])
    assert connection.status_code == 201
    connection_id = connection.json()["id"]
    with SessionLocal() as db:
        db.add(
            AccountSettings(connection_id=connection_id, custom_initial_deposit=5000.0)
        )
        db.add(
            Trade(
                connection_id=connection_id,
                ticket=4242,
                symbol="EURUSD",
                direction="BUY",
                volume=0.10,
                profit=12.5,
            )
        )
        db.commit()

    other_admin = make_user("admin", enrolled=True)
    other_headers = _login(client, other_admin)
    denied = client.get(
        f"/api/v1/admin/support/users/{target_id}/detail", headers=other_headers
    )
    assert denied.status_code == 403

    granted_before = _audit_count("support.granted", target_id)
    grant = client.post(
        "/api/v1/admin/support/sessions",
        json={"target_user_id": target_id, "reason": "investigate missing trades"},
        headers=support_headers,
    )
    assert grant.status_code == 201, grant.text
    session = grant.json()
    session_id = session["id"]
    assert session["active"] is True
    assert 0 < session["seconds_remaining"] <= settings.SUPPORT_SESSION_MINUTES * 60
    assert session["reason"] == "investigate missing trades"
    assert _audit_count("support.granted", target_id) == granted_before + 1

    # A second concurrent grant for the same pair is rejected.
    duplicate = client.post(
        "/api/v1/admin/support/sessions",
        json={"target_user_id": target_id, "reason": "again"},
        headers=support_headers,
    )
    assert duplicate.status_code == 409

    viewed_before = _audit_count("support.detail_viewed", target_id)
    detail = client.get(
        f"/api/v1/admin/support/users/{target_id}/detail", headers=support_headers
    )
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["username"] == account["username"]
    assert [trade["ticket"] for trade in body["trades"]] == [4242]
    assert body["account_settings"][0]["custom_initial_deposit"] == 5000.0
    assert _audit_count("support.detail_viewed", target_id) == viewed_before + 1

    # The affected user sees exactly who opened their data.
    log = client.get("/api/v1/access-log", headers=account["headers"])
    assert log.status_code == 200
    actions = [item["action"] for item in log.json()["items"]]
    assert "support.granted" in actions
    assert "support.detail_viewed" in actions
    assert all(
        item["actor_username"] == support["username"] for item in log.json()["items"]
    )

    revoked_before = _audit_count("support.revoked", target_id)
    revoke = client.post(
        f"/api/v1/admin/support/sessions/{session_id}/revoke", headers=support_headers
    )
    assert revoke.status_code == 200
    assert revoke.json()["revoked_at"] is not None
    assert _audit_count("support.revoked", target_id) == revoked_before + 1

    after_revoke = client.get(
        f"/api/v1/admin/support/users/{target_id}/detail", headers=support_headers
    )
    assert after_revoke.status_code == 403


def test_expired_session_is_rejected(client, account, make_user, monkeypatch):
    monkeypatch.setattr(settings, "SUPPORT_MODE_ENABLED", True)

    support = make_user("support", enrolled=True)
    support_headers = _login(client, support)

    with SessionLocal() as db:
        from app.db.models import User

        target_id = db.scalar(
            select(User.id).where(User.username == account["username"])
        )

    grant = client.post(
        "/api/v1/admin/support/sessions",
        json={"target_user_id": target_id, "reason": "short investigation"},
        headers=support_headers,
    )
    assert grant.status_code == 201
    session_id = grant.json()["id"]

    with SessionLocal() as db:
        session = db.get(SupportSession, session_id)
        session.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()

    expired = client.get(
        f"/api/v1/admin/support/users/{target_id}/detail", headers=support_headers
    )
    assert expired.status_code == 403


def test_reason_is_required(client, make_user, monkeypatch):
    monkeypatch.setattr(settings, "SUPPORT_MODE_ENABLED", True)
    support = make_user("support", enrolled=True)
    target = make_user("trader")

    res = client.post(
        "/api/v1/admin/support/sessions",
        json={"target_user_id": target["id"], "reason": "x"},
        headers=_login(client, support),
    )
    assert res.status_code == 422


def test_access_log_is_scoped_to_the_user(client, account, make_user, monkeypatch):
    monkeypatch.setattr(settings, "SUPPORT_MODE_ENABLED", True)
    support = make_user("support", enrolled=True)
    support_headers = _login(client, support)
    other = make_user("trader")

    res = client.post(
        "/api/v1/admin/support/sessions",
        json={"target_user_id": other["id"], "reason": "other user issue"},
        headers=support_headers,
    )
    assert res.status_code == 201

    log = client.get("/api/v1/access-log", headers=account["headers"])
    assert log.status_code == 200
    assert log.json()["items"] == []

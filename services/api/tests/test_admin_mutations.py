"""Admin mutations must be audited in the same transaction (ADR 0008 §4)."""

from sqlalchemy import select

from app.core.config import settings
from app.db.base import SessionLocal
from app.db.models import AuditLog, Entitlement, Mt5Connection, User


def _user_id(username: str) -> str:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == username))
        assert user is not None
        return user.id


def _audit_rows(action: str) -> list[AuditLog]:
    with SessionLocal() as db:
        return list(
            db.scalars(
                select(AuditLog).where(AuditLog.action == action).order_by(AuditLog.id)
            )
        )


def test_entitlement_update_is_audited(client, admin_headers, account):
    target_id = _user_id(account["username"])

    res = client.patch(
        f"/api/v1/admin/users/{target_id}/entitlement",
        json={"plan_code": "pro", "max_connections": 7},
        headers=admin_headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["plan_code"] == "pro"
    assert res.json()["max_connections"] == 7

    with SessionLocal() as db:
        entitlement = db.get(Entitlement, target_id)
        assert entitlement.plan_code == "pro"
        assert entitlement.max_connections == 7

    rows = _audit_rows("admin.entitlement.updated")
    assert len(rows) == 1
    assert rows[0].target_user_id == target_id
    assert rows[0].user_id == _user_id(settings.ADMIN_USERNAME)


def test_unknown_plan_is_rejected_without_audit(client, admin_headers, account):
    target_id = _user_id(account["username"])
    before = len(_audit_rows("admin.entitlement.updated"))

    res = client.patch(
        f"/api/v1/admin/users/{target_id}/entitlement",
        json={"plan_code": "does-not-exist"},
        headers=admin_headers,
    )
    assert res.status_code == 400
    assert len(_audit_rows("admin.entitlement.updated")) == before


def test_deactivate_revokes_the_session_and_is_audited(client, admin_headers, account):
    target_id = _user_id(account["username"])

    res = client.post(
        f"/api/v1/admin/users/{target_id}/deactivate", headers=admin_headers
    )
    assert res.status_code == 200, res.text
    assert res.json()["is_active"] is False

    # token_version was bumped and is_active is false: the old token is dead.
    assert client.get("/api/v1/auth/me", headers=account["headers"]).status_code == 401

    rows = _audit_rows("admin.user.deactivated")
    assert len(rows) == 1
    assert rows[0].target_user_id == target_id

    activated = client.post(
        f"/api/v1/admin/users/{target_id}/activate", headers=admin_headers
    )
    assert activated.status_code == 200
    assert activated.json()["is_active"] is True
    assert len(_audit_rows("admin.user.activated")) == 1


def test_admin_cannot_deactivate_own_account(client, admin_headers):
    admin_id = _user_id(settings.ADMIN_USERNAME)
    res = client.post(
        f"/api/v1/admin/users/{admin_id}/deactivate", headers=admin_headers
    )
    assert res.status_code == 400


def test_connection_revoke_is_audited_and_never_returns_a_token(
    client, admin_headers, account
):
    created = client.post("/api/v1/connections", headers=account["headers"])
    assert created.status_code == 201, created.text
    connection_id = created.json()["id"]
    assert created.json()["token"]  # the owner sees it exactly once

    res = client.post(
        f"/api/v1/admin/connections/{connection_id}/revoke", headers=admin_headers
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "revoked"
    assert "token" not in body
    assert "token_hash" not in body
    assert body["token_prefix"]

    with SessionLocal() as db:
        connection = db.get(Mt5Connection, connection_id)
        assert connection.revoked_at is not None

    rows = _audit_rows("admin.connection.revoked")
    assert len(rows) == 1
    assert rows[0].connection_id == connection_id
    assert rows[0].target_user_id == _user_id(account["username"])


def test_admin_connection_list_has_no_token_fields(client, admin_headers, account):
    res = client.get("/api/v1/admin/connections", headers=admin_headers)
    assert res.status_code == 200
    for item in res.json()["items"]:
        assert "token" not in item
        assert "token_hash" not in item
        assert item["token_prefix"]


def test_trader_cannot_mutate(client, account):
    target_id = _user_id(account["username"])
    assert (
        client.patch(
            f"/api/v1/admin/users/{target_id}/entitlement",
            json={"plan_code": "pro"},
            headers=account["headers"],
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/v1/admin/users/{target_id}/deactivate", headers=account["headers"]
        ).status_code
        == 403
    )

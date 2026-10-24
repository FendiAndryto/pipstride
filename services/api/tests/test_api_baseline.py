"""Baseline API contract tests: health, read-only guarantee, auth."""

from app.core.config import settings


def test_health_check(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_readiness_probe(client):
    res = client.get("/ready")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ready"
    assert body["database"] == "ok"
    assert body["redis"] in {"ok", "disabled"}


def test_root_reports_read_only_mode(client):
    res = client.get("/")
    assert res.status_code == 200
    assert res.json()["mode"] == "read-only"


def test_order_execution_permanently_forbidden(client):
    res = client.post("/api/v1/bridge/order")
    assert res.status_code == 403
    assert "Pure Read-Only Journal" in res.json()["detail"]


def test_login_with_seeded_admin(client):
    res = client.post(
        "/api/v1/auth/login",
        json={"username": settings.ADMIN_USERNAME, "password": settings.ADMIN_PASSWORD},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["username"] == settings.ADMIN_USERNAME
    assert data["role"] == "admin"
    # The user-level bridge token no longer exists; tokens belong to connections.
    assert "bridge_token" not in data


def test_login_with_wrong_password_rejected(client):
    res = client.post(
        "/api/v1/auth/login",
        json={"username": settings.ADMIN_USERNAME, "password": "definitely-wrong"},
    )
    assert res.status_code == 401


def test_register_rejects_weak_password(client):
    res = client.post(
        "/api/v1/auth/register",
        json={"username": "weakling", "password": "short"},
    )
    assert res.status_code == 422


def test_me_requires_authentication(client):
    assert client.get("/api/v1/auth/me").status_code == 401


def test_me_returns_profile(client, account):
    res = client.get("/api/v1/auth/me", headers=account["headers"])
    assert res.status_code == 200
    assert res.json()["username"] == account["username"]


def test_logout_revokes_existing_token(client, account):
    assert client.post("/api/v1/auth/logout", headers=account["headers"]).status_code == 200
    # token_version was bumped, so the old bearer token is now rejected.
    assert client.get("/api/v1/auth/me", headers=account["headers"]).status_code == 401

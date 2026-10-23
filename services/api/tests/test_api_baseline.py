import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings

client = TestClient(app)


def test_health_check():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_order_permanently_forbidden_read_only():
    res = client.post("/api/v1/bridge/order")
    assert res.status_code == 403
    assert "Pure Read-Only Journal" in res.json()["detail"]


def test_auth_login_seeded_admin():
    res = client.post(
        "/api/v1/auth/login",
        json={
            "username": settings.ADMIN_USERNAME,
            "password": settings.ADMIN_PASSWORD
        }
    )
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["username"] == settings.ADMIN_USERNAME
    assert data["bridge_token"].startswith("pst_live_")

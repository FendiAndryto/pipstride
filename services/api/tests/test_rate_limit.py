"""Abuse-protection tests: login brute force and heartbeat flooding."""

from app.core import rate_limit
from app.core.config import settings
from tests.conftest import heartbeat_payload


def _heartbeat(client, token, account_number=555555):
    return client.post(
        "/api/v1/bridge/heartbeat",
        json=heartbeat_payload(account_number),
        headers={"X-Bridge-Token": token},
    )


def test_login_is_rate_limited_after_repeated_failures(client):
    rate_limit.rate_limiter.reset()
    username = "bruteforce_target"
    payload = {"username": username, "password": "definitely-wrong"}

    for _ in range(5):
        assert client.post("/api/v1/auth/login", json=payload).status_code == 401

    blocked = client.post("/api/v1/auth/login", json=payload)
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) > 0


def test_successful_login_resets_the_failure_counter(client, account):
    rate_limit.rate_limiter.reset()
    wrong = {"username": account["username"], "password": "definitely-wrong"}

    for _ in range(4):
        assert client.post("/api/v1/auth/login", json=wrong).status_code == 401

    ok = client.post(
        "/api/v1/auth/login",
        json={"username": account["username"], "password": account["password"]},
    )
    assert ok.status_code == 200

    # Without the reset this would be the fifth failure and return 429.
    assert client.post("/api/v1/auth/login", json=wrong).status_code == 401


def test_heartbeat_rate_limit_returns_retry_after(client, account, monkeypatch):
    monkeypatch.setattr(settings, "HEARTBEAT_RATE_LIMIT", 2)
    created = client.post(
        "/api/v1/connections", params={"label": "Rate Limit"}, headers=account["headers"]
    ).json()

    for _ in range(2):
        assert _heartbeat(client, created["token"]).status_code == 200

    blocked = _heartbeat(client, created["token"])
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) > 0

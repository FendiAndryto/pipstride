from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.db.base import SessionLocal
from app.db.models import AuditLog, Mt5Connection, User
from app.infrastructure.db.repositories import admin_repository


def test_overview_metrics_and_user_filters(client, admin_headers, make_user, monkeypatch):
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(admin_repository, "_now", lambda: now)
    users_url = "/api/v1/admin/users"
    metrics_url = "/api/v1/admin/metrics"
    prefix = f"overview_{uuid4().hex[:10]}"
    active = make_user(username=f"{prefix}_active")
    disabled = make_user(username=f"{prefix}_disabled", active=False)
    expired = make_user(username=f"{prefix}_expired")
    later = make_user(username=f"{prefix}_later")
    baseline = client.get(metrics_url, headers=admin_headers)
    assert baseline.status_code == 200
    baseline_pending = baseline.json()["connections"]["pending"]

    with SessionLocal() as db:
        db.get(User, active["id"]).expires_at = now + timedelta(days=7)
        db.get(User, disabled["id"]).expires_at = now + timedelta(days=1)
        db.get(User, expired["id"]).expires_at = now
        db.get(User, later["id"]).expires_at = now + timedelta(days=7, microseconds=1)
        db.add_all(
            Mt5Connection(
                user_id=user["id"],
                token_hash=uuid4().hex,
                token_prefix="overview",
                status="pending",
                revoked_at=revoked_at,
            )
            for user, revoked_at in ((active, None), (active, None), (disabled, now))
        )
        db.commit()

    metrics_response = client.get(metrics_url, headers=admin_headers)
    assert metrics_response.status_code == 200
    metrics = metrics_response.json()
    assert datetime.fromisoformat(metrics["as_of"]) == now
    assert metrics["connections"]["pending"] == baseline_pending + 2

    expiring = client.get(users_url, headers=admin_headers, params={"status": "expiring"})
    assert expiring.status_code == 200
    assert expiring.json()["total"] == metrics["users"]["expiring_soon"]

    for status in ("expiring", "pending_connection"):
        filtered = client.get(
            users_url,
            headers=admin_headers,
            params={"search": prefix, "status": status},
        )
        assert filtered.status_code == 200
        assert filtered.json()["total"] == 1
        assert [item["id"] for item in filtered.json()["items"]] == [active["id"]]

    invalid = client.get(users_url, headers=admin_headers, params={"status": "unknown"})
    assert invalid.status_code == 422


def test_audit_date_range_filters_rows_and_total(client, admin_headers):
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    target_id = str(uuid4())
    action = "test.filter.audit"
    other_action = "test.filter.other"
    with SessionLocal() as db:
        db.add_all(
            AuditLog(target_user_id=target_id, action=action, created_at=created_at)
            for created_at in (
                start - timedelta(microseconds=1),
                start,
                end - timedelta(microseconds=1),
                end,
            )
        )
        db.add(AuditLog(action=other_action, created_at=end))
        db.commit()

    response = client.get(
        "/api/v1/admin/audit",
        headers=admin_headers,
        params={
            "start": start.astimezone(timezone(timedelta(hours=7))).isoformat(),
            "end": end.isoformat(),
            "action": action,
            "target_user_id": target_id,
            "limit": 1,
            "offset": 1,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2
    assert [datetime.fromisoformat(item["created_at"]) for item in data["items"]] == [
        start
    ]
    assert {action, other_action} <= set(data["actions"])


@pytest.mark.parametrize(
    "params",
    [
        {"start": "2026-01-01"},
        {"start": "2026-01-01T00:00:00"},
        {"end": "1767225600"},
        {"start": "2026-01-02T00:00:00Z", "end": "2026-01-01T00:00:00Z"},
    ],
)
def test_audit_rejects_invalid_date_ranges(client, admin_headers, params):
    response = client.get("/api/v1/admin/audit", headers=admin_headers, params=params)
    assert response.status_code == 422

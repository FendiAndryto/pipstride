"""The plans table must come from the single-source pricing catalogue."""

import json
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.base import SessionLocal
from app.db.models import Plan
from app.services.pricing_catalog import PricingCatalogError, load_plans


def _write(path: Path, payload) -> Path:
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_seeded_plans_match_catalog(client):
    expected = {plan.code: plan for plan in load_plans()}
    with SessionLocal() as db:
        rows = {row.code: row for row in db.scalars(select(Plan)).all()}

    assert set(rows) == set(expected)
    for code, plan in expected.items():
        row = rows[code]
        assert row.name == plan.name
        assert row.max_connections == plan.max_connections
        assert row.price_cents == plan.price_cents


def test_settings_path_override(monkeypatch, tmp_path):
    path = _write(
        tmp_path / "catalog.json",
        {
            "version": 1,
            "plans": [
                {"code": "solo", "name": "Solo", "max_connections": 2, "price_cents": 100}
            ],
        },
    )
    monkeypatch.setattr(settings, "PRICING_CATALOG_PATH", str(path))
    assert [plan.code for plan in load_plans()] == ["solo"]


def test_missing_catalog_fails_loudly(tmp_path):
    with pytest.raises(PricingCatalogError, match="not found"):
        load_plans(tmp_path / "missing.json")


def test_malformed_json_fails_loudly(tmp_path):
    path = tmp_path / "catalog.json"
    path.write_text("{not-json", encoding="utf-8")
    with pytest.raises(PricingCatalogError, match="not valid JSON"):
        load_plans(path)


@pytest.mark.parametrize(
    "payload",
    [
        {"version": 1, "plans": []},
        {"version": 1, "plans": "nope"},
        {"version": 2, "plans": [{"code": "x", "name": "X", "max_connections": 1, "price_cents": 0}]},
        {"version": 1, "plans": [{"code": "", "name": "X", "max_connections": 1, "price_cents": 0}]},
        {"version": 1, "plans": [{"code": "x", "name": "X", "max_connections": 0, "price_cents": 0}]},
        {"version": 1, "plans": [{"code": "x", "name": "X", "max_connections": 1, "price_cents": -1}]},
        {"version": 1, "plans": [{"code": "x", "name": "X", "max_connections": 1, "price_cents": True}]},
        {
            "version": 1,
            "plans": [
                {"code": "x", "name": "X", "max_connections": 1, "price_cents": 0},
                {"code": "x", "name": "X2", "max_connections": 1, "price_cents": 0},
            ],
        },
    ],
)
def test_invalid_catalog_fails_loudly(tmp_path, payload):
    path = _write(tmp_path / "catalog.json", payload)
    with pytest.raises(PricingCatalogError):
        load_plans(path)

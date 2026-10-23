"""Journal analytics: pure aggregation rules plus the HTTP endpoint."""

from datetime import datetime, timedelta
from types import SimpleNamespace

from app.services.journal_service import compute_stats
from tests.conftest import heartbeat_payload


def trade(
    profit,
    *,
    symbol="EURUSD",
    direction="BUY",
    volume=0.1,
    magic=0,
    hours_held=2,
    closed="2026-10-01T10:00:00+00:00",
):
    closed_at = datetime.fromisoformat(closed)
    return SimpleNamespace(
        profit=profit,
        symbol=symbol,
        direction=direction,
        volume=volume,
        magic=magic,
        opened_at=closed_at - timedelta(hours=hours_held),
        closed_at=closed_at,
        created_at=closed_at,
    )


def test_totals_average_and_ratio_math():
    rows = [trade(100.0), trade(50.0), trade(-30.0), trade(0.0)]

    totals = compute_stats(rows)["totals"]

    assert totals["trades"] == 4
    assert totals["wins"] == 2
    assert totals["losses"] == 1
    assert totals["breakeven"] == 1
    assert totals["win_rate"] == 50.0
    assert totals["net_profit"] == 120.0
    assert totals["gross_profit"] == 150.0
    assert totals["gross_loss"] == -30.0
    assert totals["profit_factor"] == 5.0
    assert totals["expectancy"] == 30.0
    assert totals["avg_win"] == 75.0
    assert totals["avg_loss"] == -30.0
    assert totals["payoff_ratio"] == 2.5
    assert totals["best_trade"] == 100.0
    assert totals["worst_trade"] == -30.0
    assert totals["avg_hold_minutes"] == 120.0
    assert totals["total_volume"] == 0.4


def test_profit_factor_is_null_when_there_are_no_losses():
    totals = compute_stats([trade(10.0), trade(20.0)])["totals"]

    assert totals["profit_factor"] is None
    assert totals["payoff_ratio"] is None


def test_streaks_follow_chronological_order():
    rows = [
        trade(100.0, closed="2026-10-01T10:00:00+00:00"),
        trade(50.0, closed="2026-10-01T11:00:00+00:00"),
        trade(-10.0, closed="2026-10-01T12:00:00+00:00"),
        trade(-20.0, closed="2026-10-01T13:00:00+00:00"),
        trade(-5.0, closed="2026-10-01T14:00:00+00:00"),
        trade(30.0, closed="2026-10-01T15:00:00+00:00"),
    ]

    totals = compute_stats(list(reversed(rows)))["totals"]

    assert totals["max_win_streak"] == 2
    assert totals["max_loss_streak"] == 3


def test_buckets_group_by_symbol_weekday_hour_direction_and_source():
    rows = [
        trade(100.0, symbol="XAUUSD", direction="BUY", magic=0, closed="2026-10-05T09:10:00+00:00"),
        trade(-40.0, symbol="XAUUSD", direction="SELL", magic=777, closed="2026-10-05T09:40:00+00:00"),
        trade(20.0, symbol="eurusd", direction="BUY", magic=777, closed="2026-10-06T14:05:00+00:00"),
    ]

    stats = compute_stats(rows)

    assert [bucket["key"] for bucket in stats["by_symbol"]] == ["XAUUSD", "EURUSD"]
    assert stats["by_symbol"][0]["net_profit"] == 60.0
    assert stats["by_symbol"][0]["profit_factor"] == 2.5

    # 2026-10-05 is a Monday, 2026-10-06 a Tuesday.
    assert [bucket["key"] for bucket in stats["by_weekday"]] == ["Mon", "Tue"]
    assert [bucket["key"] for bucket in stats["by_hour"]] == ["09", "14"]
    assert [bucket["key"] for bucket in stats["by_direction"]] == ["BUY", "SELL"]
    assert [bucket["key"] for bucket in stats["by_source"]] == ["EA", "Manual"]
    assert stats["by_source"][0]["trades"] == 2
    assert stats["by_source"][1]["net_profit"] == 100.0


def _seed_trades(client, account):
    created = client.post(
        "/api/v1/connections", params={"label": "Journal"}, headers=account["headers"]
    ).json()
    closed = [
        {
            "ticket": 8101,
            "symbol": "EURUSD",
            "type": "BUY",
            "volume": 0.10,
            "open_price": 1.0800,
            "close_price": 1.0850,
            "profit": 75.0,
            "open_time": 1_699_000_000,
            "close_time": 1_699_500_000,
            "magic": 1234,
        },
        {
            "ticket": 8102,
            "symbol": "EURUSD",
            "type": "SELL",
            "volume": 0.05,
            "open_price": 1.0900,
            "close_price": 1.0920,
            "profit": -25.0,
            "open_time": 1_699_000_000,
            "close_time": 1_699_600_000,
            "magic": 0,
        },
    ]
    payload = heartbeat_payload(424242, closed_trades=closed)
    res = client.post(
        "/api/v1/bridge/heartbeat",
        json=payload,
        headers={"X-Bridge-Token": created["token"]},
    )
    assert res.status_code == 200, res.text
    return created


def test_stats_endpoint_aggregates_persisted_trades(client, account):
    _seed_trades(client, account)

    res = client.get(
        "/api/v1/journal/stats", params={"range": "ALL"}, headers=account["headers"]
    )
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["range"] == "ALL"
    assert body["start"] is None
    assert body["account_number"] == 424242
    assert body["totals"]["trades"] == 2
    assert body["totals"]["net_profit"] == 50.0
    assert body["totals"]["win_rate"] == 50.0
    assert [bucket["key"] for bucket in body["by_symbol"]] == ["EURUSD"]
    assert [bucket["key"] for bucket in body["by_direction"]] == ["BUY", "SELL"]


def test_stats_endpoint_filters_by_source_and_symbol(client, account):
    _seed_trades(client, account)

    ea_only = client.get(
        "/api/v1/journal/stats",
        params={"range": "ALL", "source": "ea"},
        headers=account["headers"],
    ).json()
    assert ea_only["totals"]["trades"] == 1
    assert ea_only["totals"]["net_profit"] == 75.0

    manual_only = client.get(
        "/api/v1/journal/stats",
        params={"range": "ALL", "source": "manual"},
        headers=account["headers"],
    ).json()
    assert manual_only["totals"]["trades"] == 1
    assert manual_only["totals"]["net_profit"] == -25.0

    none = client.get(
        "/api/v1/journal/stats",
        params={"range": "ALL", "symbol": "XAUUSD"},
        headers=account["headers"],
    ).json()
    assert none["totals"]["trades"] == 0
    assert none["by_symbol"] == []


def test_stats_endpoint_respects_the_time_window(client, account):
    _seed_trades(client, account)

    res = client.get(
        "/api/v1/journal/stats", params={"range": "1M"}, headers=account["headers"]
    )
    assert res.status_code == 200
    assert res.json()["totals"]["trades"] == 0


def test_stats_endpoint_rejects_unknown_range(client, account):
    _seed_trades(client, account)

    res = client.get(
        "/api/v1/journal/stats", params={"range": "10Y"}, headers=account["headers"]
    )
    assert res.status_code == 422

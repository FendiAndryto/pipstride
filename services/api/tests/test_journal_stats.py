"""Journal analytics: pure aggregation rules plus the HTTP endpoint."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy import insert

from app.db.base import SessionLocal
from app.db.models import CashFlowDeal, Trade
from app.domain.metrics import compute_stats
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


def test_journal_rows_filters_and_pages_the_combined_stream(client, account):
    connection = _seed_trades(client, account)
    start = 1_699_500_000
    end = 1_699_700_000
    with SessionLocal.begin() as db:
        db.execute(
            insert(Trade),
            [
                {
                    "connection_id": connection["id"],
                    "ticket": 8103,
                    "symbol": "xauusd",
                    "direction": "SELL",
                    "opened_at": datetime.fromtimestamp(start + 1, timezone.utc),
                    "profit": -40.0,
                },
                {
                    "connection_id": connection["id"],
                    "ticket": 8104,
                    "symbol": "GBPUSD",
                    "direction": "BUY",
                    "opened_at": datetime.fromtimestamp(end, timezone.utc),
                    "profit": 10.0,
                },
            ],
        )
        db.execute(
            insert(CashFlowDeal),
            [
                {
                    "connection_id": connection["id"],
                    "ticket": ticket,
                    "category": category,
                    "amount": amount,
                    "occurred_at": datetime.fromtimestamp(moment, timezone.utc),
                }
                for ticket, category, amount, moment in [
                    (8102, "DEPOSIT", 100.0, 1_699_600_000),
                    (8201, "WITHDRAWAL", -50.0, end - 1),
                    (8202, "DEPOSIT", 1000.0, end),
                    (8203, "WITHDRAWAL", -25.0, start - 1),
                ]
            ],
        )

    def rows(**params):
        response = client.get(
            "/api/v1/journal/rows",
            params={"start": start, "end": end, **params},
            headers=account["headers"],
        )
        assert response.status_code == 200, response.text
        return response.json()

    first = rows(limit=2)
    assert [row["ticket"] for row in first["trades"]] == [8102]
    assert [row["ticket"] for row in first["cash_flow"]] == [8201]
    assert first["total"] == 5
    assert first["trade_total"] == 3
    assert first["symbols"] == [{"symbol": "EURUSD", "count": 2}, {"symbol": "XAUUSD", "count": 1}]

    second = rows(limit=2, offset=2, include_symbols=False)
    assert [row["ticket"] for row in second["cash_flow"]] == [8102]
    assert [row["ticket"] for row in second["trades"]] == [8103]
    assert second["trades"][0]["close_time"] == start + 1
    assert second["symbols"] == []
    assert [row["ticket"] for row in rows(limit=2, offset=4)["trades"]] == [8101]
    assert rows(offset=5)["total"] == 5
    assert rows(offset=5)["trades"] == []
    assert rows(offset=5)["cash_flow"] == []

    assert rows(search="sElL")["total"] == 2
    assert rows(search="%")["total"] == 0
    assert rows(search="dEpO")["trade_total"] == 0
    assert rows(search="dEpO")["total"] == 1
    assert rows(search="8102")["total"] == 2
    assert rows(source="ea", search="EA")["total"] == 1
    assert rows(source="manual", symbol="eurusd")["total"] == 1
    assert rows(source="manual", symbol="eurusd")["symbols"] == first["symbols"]
    assert rows(trades_only=True)["total"] == 3


def test_journal_stats_uses_explicit_bounds_and_uncapped_cash_totals(client, account):
    connection = _seed_trades(client, account)
    start = 1_699_500_000
    end = 1_699_600_000
    with SessionLocal.begin() as db:
        db.execute(
            insert(CashFlowDeal),
            [
                {
                    "connection_id": connection["id"],
                    "ticket": ticket,
                    "category": "DEPOSIT",
                    "amount": 1.0,
                    "occurred_at": datetime.fromtimestamp(start, timezone.utc),
                }
                for ticket in range(5001)
            ],
        )
        db.add(
            CashFlowDeal(
                connection_id=connection["id"],
                ticket=5001,
                category="WITHDRAWAL",
                amount=-20.0,
                occurred_at=datetime.fromtimestamp(end, timezone.utc),
            )
        )

    def stats(**params):
        return client.get("/api/v1/journal/stats", params=params, headers=account["headers"])

    response = stats(range="MONTH", start=start, end=end, include_daily=True)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["start"] == start
    assert body["end"] == end
    assert body["totals"]["trades"] == 1
    assert body["daily_pnl"] == {"2023-11-09": 75.0}
    assert body["cash_flow"] == {"deposits": 5001.0, "withdrawals": 0.0, "net_funding": 5001.0}

    filtered = stats(range="1M", end=end, source="manual", symbol="EURUSD").json()
    assert filtered["start"] is None
    assert filtered["totals"]["trades"] == 0
    assert filtered["cash_flow"] == body["cash_flow"]
    assert "daily_pnl" not in filtered
    assert stats(range="MONTH", end=end).status_code == 422
    assert stats(range="MONTH", start=end, end=start).status_code == 422

    response = client.get(
        "/api/v1/journal/rows", params={"limit": 2, "offset": 5002}, headers=account["headers"]
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 5004
    assert body["trade_total"] == 2
    assert [row["ticket"] for row in body["cash_flow"]] == [1, 0]

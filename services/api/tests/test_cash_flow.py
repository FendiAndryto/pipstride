"""Cash flow stream: deposits and withdrawals stay out of the trading path.

The whole point of the separate ``cash_flow_deals`` table is that a balance deal
can never reach a trading aggregate. These tests guard both halves: the stream
is persisted and reported, and it never changes ``trades`` / ``compute_stats``.
"""

from types import SimpleNamespace

from sqlalchemy import func, select

from app.db.base import SessionLocal
from app.db.models import CashFlowDeal, Trade
from app.domain.metrics import compute_cash_flow
from tests.conftest import heartbeat_payload

ACCOUNT = 616161


def create_connection(client, account):
    res = client.post(
        "/api/v1/connections", params={"label": "Cash Flow"}, headers=account["headers"]
    )
    assert res.status_code == 201, res.text
    return res.json()


def cash_flow_items():
    """One deposit (the baseline), one withdrawal, one later deposit."""
    return [
        {
            "ticket": 7101,
            "category": "DEPOSIT",
            "profit": 1000.0,
            "time": 1_699_400_000,
        },
        {
            "ticket": 7102,
            "category": "WITHDRAWAL",
            "profit": -300.0,
            "time": 1_699_600_000,
        },
        {"ticket": 7103, "category": "DEPOSIT", "profit": 200.0, "time": 1_699_700_000},
    ]


def deal(amount, category):
    return SimpleNamespace(amount=amount, category=category)


def test_compute_cash_flow_reports_both_directions():
    totals = compute_cash_flow(
        [deal(1000.0, "DEPOSIT"), deal(-300.0, "WITHDRAWAL"), deal(200.0, "deposit")]
    )

    assert totals == {"deposits": 1200.0, "withdrawals": 300.0, "net_funding": 900.0}


def test_compute_cash_flow_is_empty_without_deals():
    assert compute_cash_flow([]) == {
        "deposits": 0.0,
        "withdrawals": 0.0,
        "net_funding": 0.0,
    }


def test_heartbeat_persists_cash_flow_and_is_idempotent(client, account):
    created = create_connection(client, account)
    body = heartbeat_payload(ACCOUNT, cash_flow=cash_flow_items(), closed_trades=[])

    for _ in range(2):
        res = client.post(
            "/api/v1/bridge/heartbeat",
            json=body,
            headers={"X-Bridge-Token": created["token"]},
        )
        assert res.status_code == 200, res.text

    with SessionLocal() as db:
        count = db.scalar(
            select(func.count(CashFlowDeal.id)).where(
                CashFlowDeal.connection_id == created["id"]
            )
        )
    assert count == 3

    history = client.get("/api/v1/bridge/history", headers=account["headers"]).json()
    assert history["total_deposits"] == 1200.0
    assert history["total_withdrawals"] == 300.0
    assert history["net_funding"] == 900.0
    assert {item["category"] for item in history["cash_flow"]} == {
        "DEPOSIT",
        "WITHDRAWAL",
    }
    assert all("symbol" not in item for item in history["cash_flow"])


def test_balance_deals_never_enter_the_trade_table(client, account):
    created = create_connection(client, account)
    payload = heartbeat_payload(ACCOUNT, cash_flow=cash_flow_items())

    res = client.post(
        "/api/v1/bridge/heartbeat",
        json=payload,
        headers={"X-Bridge-Token": created["token"]},
    )
    assert res.status_code == 200, res.text

    with SessionLocal() as db:
        trade_tickets = set(
            db.scalars(select(Trade.ticket).where(Trade.connection_id == created["id"]))
        )
    assert trade_tickets == {5001, 5002}

    history = client.get("/api/v1/bridge/history", headers=account["headers"]).json()
    assert history["total_trades"] == 2
    assert history["net_pnl"] == 30.0
    assert {item["ticket"] for item in history["trades"]} == {5001, 5002}


def test_sync_trades_carries_both_streams(client, account):
    created = create_connection(client, account)

    res = client.post(
        "/api/v1/bridge/sync-trades",
        json={
            "account_number": ACCOUNT,
            "closed_trades": heartbeat_payload(ACCOUNT)["closed_trades"],
            "cash_flow": cash_flow_items(),
        },
        headers={"X-Bridge-Token": created["token"]},
    )
    assert res.status_code == 200, res.text
    assert res.json()["inserted"] == 2
    assert res.json()["cash_flow_inserted"] == 3

    history = client.get("/api/v1/bridge/history", headers=account["headers"]).json()
    assert len(history["trades"]) == 2
    assert len(history["cash_flow"]) == 3
    assert history["total_deposits"] == 1200.0


def test_journal_stats_reports_cash_flow_beside_trading_metrics(client, account):
    created = create_connection(client, account)
    payload = heartbeat_payload(ACCOUNT, cash_flow=cash_flow_items())
    client.post(
        "/api/v1/bridge/heartbeat",
        json=payload,
        headers={"X-Bridge-Token": created["token"]},
    )

    body = client.get(
        "/api/v1/journal/stats", params={"range": "ALL"}, headers=account["headers"]
    ).json()

    # Trading aggregates ignore cash flow entirely.
    assert body["totals"]["trades"] == 2
    assert body["totals"]["net_profit"] == 30.0
    assert {bucket["key"] for bucket in body["by_symbol"]} == {"EURUSD", "XAUUSD"}
    # Cash flow is a sibling field, never folded into totals.
    assert body["cash_flow"] == {
        "deposits": 1200.0,
        "withdrawals": 300.0,
        "net_funding": 900.0,
    }


def test_equity_curve_applies_cash_flow_as_step_events(client, account):
    created = create_connection(client, account)
    payload = heartbeat_payload(ACCOUNT, cash_flow=cash_flow_items())
    payload["initial_deposit"] = 1000.0
    client.post(
        "/api/v1/bridge/heartbeat",
        json=payload,
        headers={"X-Bridge-Token": created["token"]},
    )

    body = client.get(
        "/api/v1/bridge/equity-curve",
        params={"range": "ALL"},
        headers=account["headers"],
    ).json()

    equities = [point["equity"] for point in body["points"]]
    # Baseline 1000 (the earliest deposit is the baseline, not an event), then
    # +50 trade, -300 withdrawal, +200 deposit, -20 trade. The live point the
    # service appends last mirrors the heartbeat equity, so it is ignored here.
    assert equities[0] == 1000.0
    assert equities[1:5] == [1050.0, 750.0, 950.0, 930.0]


def test_equity_curve_counts_every_deposit_when_the_baseline_is_overridden(
    client, account
):
    created = create_connection(client, account)
    payload = heartbeat_payload(ACCOUNT, cash_flow=cash_flow_items())
    payload["initial_deposit"] = 1000.0
    client.post(
        "/api/v1/bridge/heartbeat",
        json=payload,
        headers={"X-Bridge-Token": created["token"]},
    )

    override = client.post(
        "/api/v1/bridge/initial-deposit",
        json={"initial_deposit": 5000.0},
        headers=account["headers"],
    )
    assert override.status_code == 200, override.text

    body = client.get(
        "/api/v1/bridge/equity-curve",
        params={"range": "ALL"},
        headers=account["headers"],
    ).json()

    equities = [point["equity"] for point in body["points"]]
    # A manual baseline is not a cash event, so the 1000 opening deposit is
    # applied as a step instead of being swallowed as the starting point.
    assert equities[0] == 5000.0
    assert equities[1:5] == [6000.0, 6050.0, 5750.0, 5950.0]
    assert equities[5] == 5930.0


def test_reset_journal_clears_cash_flow(client, account):
    created = create_connection(client, account)
    payload = heartbeat_payload(ACCOUNT, cash_flow=cash_flow_items())
    client.post(
        "/api/v1/bridge/heartbeat",
        json=payload,
        headers={"X-Bridge-Token": created["token"]},
    )

    res = client.post("/api/v1/bridge/history/reset", headers=account["headers"])
    assert res.status_code == 200, res.text

    history = client.get("/api/v1/bridge/history", headers=account["headers"]).json()
    assert history["trades"] == []
    assert history["cash_flow"] == []
    assert history["total_deposits"] == 0.0
    with SessionLocal() as db:
        assert (
            db.scalar(
                select(func.count(CashFlowDeal.id)).where(
                    CashFlowDeal.connection_id == created["id"]
                )
            )
            == 0
        )

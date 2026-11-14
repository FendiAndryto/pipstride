"""Cash flow stream: deposits and withdrawals stay out of the trading path.

The whole point of the separate ``cash_flow_deals`` table is that a balance deal
can never reach a trading aggregate. These tests guard both halves: the stream
is persisted and reported, and it never changes ``trades`` / ``compute_stats``.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.db.base import SessionLocal
from app.db.models import CashFlowDeal, TelemetrySnapshot, Trade
from app.domain.metrics import compute_cash_flow
from tests.conftest import heartbeat_payload

ACCOUNT = 616161


def create_connection(client, account):
    res = client.post(
        "/api/v1/connections", params={"label": "Cash Flow"}, headers=account["headers"]
    )
    assert res.status_code == 201, res.text
    return res.json()


def send_heartbeat(client, created, **overrides):
    payload = heartbeat_payload(ACCOUNT, **overrides)
    res = client.post(
        "/api/v1/bridge/heartbeat",
        json=payload,
        headers={"X-Bridge-Token": created["token"]},
    )
    assert res.status_code == 200, res.text
    return res.json()


def risk(client, account):
    res = client.get("/api/v1/bridge/risk", headers=account["headers"])
    assert res.status_code == 200, res.text
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


# ---------------------------------------------------------------- drawdown
# Cash movements are capital transfers, not trading results. These tests pin the
# trade-only risk basis of spec 008: a withdrawal lowers the capital that can be
# lost instead of fabricating a drawdown, and a deposit cannot hide one.


def seed_snapshot(connection_id, *, captured_at, balance, equity):
    """Direct observation row: the anchor is a time-stamped equity reading."""
    with SessionLocal() as db:
        db.add(
            TelemetrySnapshot(
                connection_id=connection_id,
                captured_at=captured_at,
                balance=balance,
                equity=equity,
                margin=0.0,
                free_margin=balance,
                margin_level=0.0,
                floating_pnl=0.0,
                open_positions=0,
            )
        )
        db.commit()


def seed_cash(connection_id, *, ticket, category, amount, occurred_at):
    with SessionLocal() as db:
        db.add(
            CashFlowDeal(
                connection_id=connection_id,
                ticket=ticket,
                category=category,
                amount=amount,
                occurred_at=occurred_at,
            )
        )
        db.commit()


def test_daily_drawdown_neutral_on_withdrawal(client, account):
    """A $1,700 withdrawal on a $1,925.39 anchor is 0%, not 88.29%.

    The capital that can be lost simply became $225.39; no trade lost anything.
    """
    created = create_connection(client, account)
    now = datetime.now(timezone.utc)
    seed_snapshot(
        created["id"],
        captured_at=now - timedelta(minutes=10),
        balance=1925.39,
        equity=1925.39,
    )
    seed_cash(
        created["id"],
        ticket=8101,
        category="WITHDRAWAL",
        amount=-1700.0,
        occurred_at=now - timedelta(minutes=5),
    )
    send_heartbeat(
        client,
        created,
        balance=225.39,
        equity=225.39,
        initial_deposit=1925.39,
        floating_pnl=0.0,
        closed_trades=[],
        cash_flow=[],
    )

    data = risk(client, account)
    assert data["daily_cash_flow"] == pytest.approx(-1700.0, abs=0.01)
    assert data["daily_anchor_adjusted"] == pytest.approx(225.39, abs=0.01)
    assert data["daily_starting_equity"] == pytest.approx(225.39, abs=0.01)
    assert data["daily_drawdown_percent"] == pytest.approx(0.0, abs=0.01)
    assert data["daily_max_drawdown_percent"] == pytest.approx(0.0, abs=0.01)
    assert data["is_alert_active"] is False


def test_daily_drawdown_on_withdrawal_with_trading_loss(client, account):
    """The loss after a withdrawal is measured on the remaining capital.

    $1,000 anchor, $200 withdrawn (capital $800), then -$40 floating: 5%.
    """
    created = create_connection(client, account)
    now = datetime.now(timezone.utc)
    seed_snapshot(
        created["id"],
        captured_at=now - timedelta(minutes=10),
        balance=1000.0,
        equity=1000.0,
    )
    seed_cash(
        created["id"],
        ticket=8201,
        category="WITHDRAWAL",
        amount=-200.0,
        occurred_at=now - timedelta(minutes=5),
    )
    send_heartbeat(
        client,
        created,
        balance=800.0,
        equity=760.0,
        initial_deposit=1000.0,
        floating_pnl=-40.0,
        closed_trades=[],
        cash_flow=[],
    )

    data = risk(client, account)
    assert data["daily_anchor_adjusted"] == pytest.approx(800.0, abs=0.01)
    assert data["daily_drawdown_percent"] == pytest.approx(5.0, abs=0.01)
    assert data["daily_max_drawdown_percent"] == pytest.approx(5.0, abs=0.01)
    assert data["is_alert_active"] is True


def test_daily_drawdown_on_deposit_with_trading_loss(client, account):
    """A deposit raises the capital at risk, so it cannot hide a loss.

    $1,000 anchor, $500 deposited (capital $1,500), then -$150 floating: 10%,
    not the 0% the pre-spec-008 formula reported.
    """
    created = create_connection(client, account)
    now = datetime.now(timezone.utc)
    seed_snapshot(
        created["id"],
        captured_at=now - timedelta(minutes=10),
        balance=1000.0,
        equity=1000.0,
    )
    seed_cash(
        created["id"],
        ticket=8301,
        category="DEPOSIT",
        amount=500.0,
        occurred_at=now - timedelta(minutes=5),
    )
    send_heartbeat(
        client,
        created,
        balance=1500.0,
        equity=1350.0,
        initial_deposit=1000.0,
        floating_pnl=-150.0,
        closed_trades=[],
        cash_flow=[],
    )

    data = risk(client, account)
    assert data["daily_cash_flow"] == pytest.approx(500.0, abs=0.01)
    assert data["daily_anchor_adjusted"] == pytest.approx(1500.0, abs=0.01)
    assert data["daily_drawdown_percent"] == pytest.approx(10.0, abs=0.01)
    assert data["is_alert_active"] is True


def test_overall_drawdown_neutral_on_withdrawal(client, account):
    """A withdrawal must not become a permanent peak-to-trough drawdown.

    The reconstructed peak is cash-neutralized, so the live equity still sits on
    its performance peak instead of 88% below a peak the trader never lost.
    """
    created = create_connection(client, account)
    now = datetime.now(timezone.utc)
    seed_snapshot(
        created["id"],
        captured_at=now - timedelta(minutes=10),
        balance=1925.39,
        equity=1925.39,
    )
    seed_cash(
        created["id"],
        ticket=8401,
        category="WITHDRAWAL",
        amount=-1700.0,
        occurred_at=now - timedelta(minutes=5),
    )
    send_heartbeat(
        client,
        created,
        balance=225.39,
        equity=225.39,
        initial_deposit=1925.39,
        floating_pnl=0.0,
        closed_trades=[],
        cash_flow=[],
    )

    data = risk(client, account)
    assert data["peak_equity"] == pytest.approx(1925.39, abs=0.01)
    assert data["overall_drawdown_percent"] == pytest.approx(0.0, abs=0.01)
    assert data["max_drawdown_percent"] == pytest.approx(0.0, abs=0.01)
    assert data["is_overall_alert_active"] is False


def test_daily_realized_neutral_on_cash_flow(client, account):
    """``daily_realized_pnl`` is closed trading P&L, never the cash movement."""
    created = create_connection(client, account)
    now = datetime.now(timezone.utc)
    seed_snapshot(
        created["id"],
        captured_at=now - timedelta(minutes=10),
        balance=1000.0,
        equity=1000.0,
    )
    seed_cash(
        created["id"],
        ticket=8502,
        category="WITHDRAWAL",
        amount=-300.0,
        occurred_at=now - timedelta(minutes=5),
    )
    send_heartbeat(
        client,
        created,
        balance=750.0,
        equity=750.0,
        initial_deposit=1000.0,
        floating_pnl=0.0,
        closed_trades=[
            {
                "ticket": 8501,
                "symbol": "EURUSD",
                "type": "BUY",
                "volume": 0.10,
                "open_price": 1.0800,
                "close_price": 1.0850,
                "profit": 50.0,
                "open_time": int((now - timedelta(minutes=8)).timestamp()),
                "close_time": int((now - timedelta(minutes=4)).timestamp()),
            }
        ],
        cash_flow=[],
    )

    data = risk(client, account)
    # balance 750 - adjusted anchor (1000 - 300) = the +50 trade, nothing else.
    assert data["daily_realized_pnl"] == pytest.approx(50.0, abs=0.01)
def test_daily_max_drawdown_keeps_the_intraday_trough_after_withdrawal(client, account):
    """The segment trough survives a recovery, and it uses the post-cash capital.

    $1,000 anchor, $200 withdrawn (capital $800), a -$40 dip to $760, then a
    recovery to $790. The live reading is 1.25%, but the day's worst is 5% and
    must stay on the record — otherwise a 3% breach disappears the moment price
    comes back.
    """
    created = create_connection(client, account)
    now = datetime.now(timezone.utc)
    seed_snapshot(
        created["id"],
        captured_at=now - timedelta(minutes=10),
        balance=1000.0,
        equity=1000.0,
    )
    seed_cash(
        created["id"],
        ticket=8601,
        category="WITHDRAWAL",
        amount=-200.0,
        occurred_at=now - timedelta(minutes=5),
    )
    seed_snapshot(
        created["id"],
        captured_at=now - timedelta(minutes=3),
        balance=800.0,
        equity=760.0,
    )
    send_heartbeat(
        client,
        created,
        balance=800.0,
        equity=790.0,
        initial_deposit=1000.0,
        floating_pnl=-10.0,
        closed_trades=[],
        cash_flow=[],
    )

    data = risk(client, account)
    assert data["daily_drawdown_percent"] == pytest.approx(1.25, abs=0.01)
    assert data["daily_max_drawdown_percent"] == pytest.approx(5.0, abs=0.01)
    assert data["is_alert_active"] is True

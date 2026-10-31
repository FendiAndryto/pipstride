"""Connection lifecycle and MT5 telemetry ingest tests."""

from tests.conftest import grant_connections, heartbeat_payload


def create_connection(client, account, label="Akun Utama"):
    res = client.post(
        "/api/v1/connections", params={"label": label}, headers=account["headers"]
    )
    assert res.status_code == 201, res.text
    return res.json()


def send_heartbeat(client, token, payload):
    return client.post(
        "/api/v1/bridge/heartbeat",
        json=payload,
        headers={"X-Bridge-Token": token},
    )


def test_create_connection_returns_token_once(client, account):
    created = create_connection(client, account)
    assert created["token"].startswith("pst_live_")
    assert created["token_prefix"] == created["token"][: len("pst_live_") + 4]
    assert created["status"] == "pending"

    listing = client.get("/api/v1/connections", headers=account["headers"]).json()
    assert len(listing) == 1
    assert "token" not in listing[0]
    assert created["token"] not in str(listing)


def test_connection_quota_is_enforced(client, account):
    create_connection(client, account)
    second = client.post("/api/v1/connections", headers=account["headers"])
    assert second.status_code == 409


def test_heartbeat_binds_token_to_first_account(client, account):
    created = create_connection(client, account)

    first = send_heartbeat(client, created["token"], heartbeat_payload(111111))
    assert first.status_code == 200, first.text

    listing = client.get("/api/v1/connections", headers=account["headers"]).json()
    assert listing[0]["status"] == "connected"
    assert listing[0]["account_number"] == 111111
    assert listing[0]["broker_server"] == "Pipstride-Demo"


def test_heartbeat_with_other_account_is_rejected(client, account):
    created = create_connection(client, account)
    send_heartbeat(client, created["token"], heartbeat_payload(111111))

    hijack = send_heartbeat(client, created["token"], heartbeat_payload(999999))
    assert hijack.status_code == 409


def test_unknown_token_is_rejected(client):
    res = client.post(
        "/api/v1/bridge/heartbeat",
        json=heartbeat_payload(123456),
        headers={"X-Bridge-Token": "pst_live_totally-invalid"},
    )
    assert res.status_code == 401


def test_status_reports_live_metrics_after_heartbeat(client, account):
    created = create_connection(client, account)
    send_heartbeat(client, created["token"], heartbeat_payload(222222))

    res = client.get("/api/v1/bridge/status", headers=account["headers"])
    assert res.status_code == 200
    data = res.json()

    assert data["is_connected"] is True
    assert data["metrics"]["balance"] == 10_500.0
    assert data["initial_deposit"] == 10_000.0
    assert data["settled_pnl"] == 500.0
    assert data["settled_pnl_percent"] == 5.0
    assert data["closed_trades_count"] == 2
    assert data["positions"][0]["symbol"] == "EURUSD"


def test_status_without_connection_returns_conflict(client, account):
    res = client.get("/api/v1/bridge/status", headers=account["headers"])
    assert res.status_code == 409


def test_positions_and_market_quotes_are_served(client, account):
    created = create_connection(client, account)
    send_heartbeat(client, created["token"], heartbeat_payload(333333))

    positions = client.get("/api/v1/bridge/positions", headers=account["headers"]).json()
    quotes = client.get("/api/v1/bridge/market", headers=account["headers"]).json()

    assert positions[0]["ticket"] == 9001
    assert positions[0]["pnl"] == -5.0
    assert quotes[0]["symbol"] == "EURUSD"
    assert quotes[0]["spread"] == 10


def test_trade_history_is_persisted_and_deduplicated(client, account):
    created = create_connection(client, account)
    payload = heartbeat_payload(444444)
    send_heartbeat(client, created["token"], payload)
    # The EA re-sends the same deals on every poll; they must not duplicate.
    send_heartbeat(client, created["token"], payload)

    res = client.get("/api/v1/bridge/history", headers=account["headers"])
    assert res.status_code == 200
    data = res.json()

    assert data["total_trades"] == 2
    assert data["net_pnl"] == 30.0
    assert data["gross_profit"] == 50.0
    assert data["gross_loss"] == -20.0
    assert data["winning_trades"] == 1
    assert data["losing_trades"] == 1
    assert data["win_rate"] == 50.0
    assert data["profit_factor"] == 2.5


def test_initial_deposit_override_wins_over_mt5(client, account):
    created = create_connection(client, account)
    send_heartbeat(client, created["token"], heartbeat_payload(555555))

    res = client.post(
        "/api/v1/bridge/initial-deposit",
        json={"initial_deposit": 5_000.0},
        headers=account["headers"],
    )
    assert res.status_code == 200
    data = res.json()
    assert data["initial_deposit"] == 5_000.0
    assert data["is_overridden"] is True
    assert data["settled_pnl"] == 5_500.0

    reset = client.post(
        "/api/v1/bridge/initial-deposit",
        json={"initial_deposit": None},
        headers=account["headers"],
    )
    assert reset.json()["initial_deposit"] == 10_000.0
    assert reset.json()["is_overridden"] is False


def test_risk_watchdog_is_passive(client, account):
    created = create_connection(client, account)
    send_heartbeat(client, created["token"], heartbeat_payload(666666))

    res = client.get("/api/v1/bridge/risk", headers=account["headers"])
    assert res.status_code == 200
    data = res.json()
    # Daily drawdown is computed against the daily starting balance (not initial deposit).
    # Balance 10,500, Equity 10,450 -> 50 / 10,500 = 0.48% (below the 3.0% threshold).
    assert data["daily_drawdown_percent"] == 0.48
    assert data["is_alert_active"] is False


def test_daily_drawdown_calculated_from_daily_start_balance(client, account):
    """Daily drawdown is measured from start-of-day balance, not initial deposit."""
    created = create_connection(client, account)
    # Account grew from 10,000 initial deposit to 12,000 balance.
    # Today's equity drops to 11,640 -> 360 / 12,000 = 3.0% daily drawdown.
    # Against initial deposit (10,000) this would wrongly show 0%, but against
    # daily balance (12,000) it correctly triggers the 3.0% watchdog alert.
    payload = heartbeat_payload(
        999999, balance=12_000.0, equity=11_640.0, initial_deposit=10_000.0, closed_trades=[]
    )
    send_heartbeat(client, created["token"], payload)

    res = client.get("/api/v1/bridge/risk", headers=account["headers"])
    assert res.status_code == 200
    data = res.json()
    assert data["daily_drawdown_percent"] == 3.0
    assert data["is_alert_active"] is True


def test_rotate_token_invalidates_old_token_and_rebinds(client, account):
    created = create_connection(client, account)
    send_heartbeat(client, created["token"], heartbeat_payload(777777))

    rotated = client.post(
        f"/api/v1/connections/{created['id']}/rotate", headers=account["headers"]
    )
    assert rotated.status_code == 200
    new_token = rotated.json()["token"]
    assert new_token != created["token"]
    assert rotated.json()["status"] == "pending"
    assert rotated.json()["account_number"] is None

    assert send_heartbeat(client, created["token"], heartbeat_payload(777777)).status_code == 401
    assert send_heartbeat(client, new_token, heartbeat_payload(888888)).status_code == 200


def test_revoke_connection_stops_telemetry(client, account):
    created = create_connection(client, account)
    send_heartbeat(client, created["token"], heartbeat_payload(121212))

    deleted = client.delete(
        f"/api/v1/connections/{created['id']}", headers=account["headers"]
    )
    assert deleted.status_code == 204

    assert send_heartbeat(client, created["token"], heartbeat_payload(121212)).status_code == 401
    assert client.get("/api/v1/connections", headers=account["headers"]).json() == []


def test_connections_are_isolated_per_user(client, account):
    created = create_connection(client, account)

    other = client.post(
        "/api/v1/auth/register",
        json={"username": "intruder_user", "password": "Passw0rd123"},
    )
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    res = client.get(
        "/api/v1/bridge/status",
        headers={**other_headers, "X-Connection-Id": created["id"]},
    )
    assert res.status_code == 404


def test_account_switching_via_header(client, account):
    grant_connections(account["username"], 3)

    first = create_connection(client, account, label="Akun A")
    second = create_connection(client, account, label="Akun B")

    send_heartbeat(client, first["token"], heartbeat_payload(100001, balance=11_000.0))
    send_heartbeat(client, second["token"], heartbeat_payload(100002, balance=22_000.0))

    res_a = client.get(
        "/api/v1/bridge/status",
        headers={**account["headers"], "X-Connection-Id": first["id"]},
    )
    res_b = client.get(
        "/api/v1/bridge/status",
        headers={**account["headers"], "X-Connection-Id": second["id"]},
    )

    assert res_a.json()["metrics"]["balance"] == 11_000.0
    assert res_b.json()["metrics"]["balance"] == 22_000.0


def test_duplicate_account_on_second_connection_is_rejected(client, account):
    grant_connections(account["username"], 3)

    first = create_connection(client, account, label="Akun A")
    second = create_connection(client, account, label="Akun B")

    assert send_heartbeat(client, first["token"], heartbeat_payload(909090)).status_code == 200
    duplicate = send_heartbeat(client, second["token"], heartbeat_payload(909090))
    assert duplicate.status_code == 409


def test_account_can_be_reconnected_after_revoke(client, account):
    first = create_connection(client, account, label="Akun A")
    send_heartbeat(client, first["token"], heartbeat_payload(919191))

    assert client.delete(
        f"/api/v1/connections/{first['id']}", headers=account["headers"]
    ).status_code == 204

    second = create_connection(client, account, label="Akun A baru")
    assert send_heartbeat(client, second["token"], heartbeat_payload(919191)).status_code == 200


def test_journal_reset_clears_trades(client, account):
    created = create_connection(client, account)
    send_heartbeat(client, created["token"], heartbeat_payload(131313))

    assert client.get("/api/v1/bridge/history", headers=account["headers"]).json()["total_trades"] == 2

    res = client.post("/api/v1/bridge/history/reset", headers=account["headers"])
    assert res.status_code == 200
    assert client.get("/api/v1/bridge/history", headers=account["headers"]).json()["total_trades"] == 0

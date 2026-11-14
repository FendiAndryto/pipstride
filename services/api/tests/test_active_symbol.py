"""Dashboard -> monitor control channel: which symbol to stream (ticket 13-04).

The MT5 sensor is now a chartless Service, so ``_Symbol`` no longer means
anything. The symbol and the quote watchlist therefore travel over the heartbeat
response, set through a JWT route. These tests pin that contract.
"""

from app.core import live_state
from app.core.config import settings
from tests.conftest import grant_connections, heartbeat_payload

ACTIVE_URL = "/api/v1/bridge/active-symbol"
# Deliberately absent from MT5_MONITORED_SYMBOLS: selecting it proves the route
# appends new instruments to the watchlist instead of only reordering it.
NEW_SYMBOL = "AUDCAD"


def create_connection(client, account, label="Symbol Control"):
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


def set_symbol(client, account, symbol, connection_id=None):
    headers = dict(account["headers"])
    if connection_id:
        headers["X-Connection-Id"] = connection_id
    return client.put(ACTIVE_URL, json={"symbol": symbol}, headers=headers)


def test_active_symbol_requires_jwt(client):
    res = client.put(ACTIVE_URL, json={"symbol": "GBPUSD"})
    assert res.status_code == 401


def test_active_symbol_is_normalised_and_echoed_back(client, account):
    created = create_connection(client, account)

    res = set_symbol(client, account, NEW_SYMBOL.lower(), created["id"])

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "ok"
    assert body["active_market_symbol"] == NEW_SYMBOL
    assert NEW_SYMBOL in body["watchlist"]


def test_active_symbol_rejects_unsafe_symbols(client, account):
    created = create_connection(client, account)

    for bad in ["", "GB PUSD", "GBP/USD", "X" * 33, 'GBPUSD"}']:
        res = set_symbol(client, account, bad, created["id"])
        assert res.status_code == 422, f"{bad!r} should be rejected: {res.text}"


def test_heartbeat_response_carries_the_control_state(client, account):
    created = create_connection(client, account)
    set_symbol(client, account, NEW_SYMBOL.lower(), created["id"])

    res = send_heartbeat(client, created["token"], heartbeat_payload(424242))

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["active_market_symbol"] == NEW_SYMBOL
    assert NEW_SYMBOL in body["watchlist"]


def test_heartbeat_without_selection_still_reports_the_default_watchlist(
    client, account
):
    created = create_connection(client, account)

    res = send_heartbeat(client, created["token"], heartbeat_payload(424243))

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["active_market_symbol"] is None
    assert body["watchlist"] == live_state.default_watchlist()
    assert body["watchlist"] == [
        item.strip().upper()
        for item in settings.MT5_MONITORED_SYMBOLS.split(",")
        if item.strip()
    ]


def test_selection_is_scoped_to_one_connection(client, account):
    grant_connections(account["username"], 3)

    first = create_connection(client, account, label="Akun A")
    second = create_connection(client, account, label="Akun B")

    set_symbol(client, account, NEW_SYMBOL.lower(), first["id"])

    first_beat = send_heartbeat(client, first["token"], heartbeat_payload(515151))
    second_beat = send_heartbeat(client, second["token"], heartbeat_payload(525252))

    assert first_beat.json()["active_market_symbol"] == NEW_SYMBOL
    assert second_beat.json()["active_market_symbol"] is None
    assert NEW_SYMBOL not in second_beat.json()["watchlist"]


def test_selecting_the_same_symbol_does_not_duplicate_the_watchlist(client, account):
    created = create_connection(client, account)

    for _ in range(3):
        res = set_symbol(client, account, "XAUUSD", created["id"])
        assert res.status_code == 200, res.text

    watchlist = res.json()["watchlist"]
    assert watchlist.count("XAUUSD") == 1

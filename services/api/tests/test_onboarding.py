"""Onboarding preset (.set) generation tests."""

import pytest

from app.services.mt5_package import build_preset, sanitize_symbols


def _create(client, account, label="Akun Utama"):
    res = client.post(
        "/api/v1/connections", params={"label": label}, headers=account["headers"]
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_create_connection_returns_importable_preset(client, account):
    created = _create(client, account)
    preset = created["preset"]

    assert preset is not None
    assert preset["filename"] == "PipstrideMonitor_Akun-Utama.set"
    assert preset["backend_url"].startswith("http://testserver")

    content = preset["content"]
    assert f"InpBridgeToken={created['token']}" in content
    assert f"InpBackendUrl={preset['backend_url']}" in content
    assert "InpMonitoredSymbols=" in content
    assert "InpHeartbeatInterval=" in content


def test_rotate_returns_preset_with_new_token(client, account):
    created = _create(client, account)
    old_token = created["token"]

    res = client.post(
        f"/api/v1/connections/{created['id']}/rotate", headers=account["headers"]
    )
    assert res.status_code == 200, res.text
    rotated = res.json()

    assert rotated["token"] != old_token
    assert f"InpBridgeToken={rotated['token']}" in rotated["preset"]["content"]
    assert old_token not in rotated["preset"]["content"]


def test_preset_filename_cannot_escape_the_download_directory(client, account):
    created = _create(client, account, label="../../etc/passwd")
    filename = created["preset"]["filename"]

    assert "/" not in filename
    assert "\\" not in filename
    assert filename.startswith("PipstrideMonitor_")
    assert filename.endswith(".set")


def test_symbol_sanitizer_drops_injection_attempts():
    cleaned = sanitize_symbols("eurusd, xauusd ,BAD SYMBOL;rm -rf,,EURUSD")
    assert cleaned == "EURUSD,XAUUSD"


def test_preset_builder_rejects_malformed_token():
    with pytest.raises(ValueError):
        build_preset("pst_live_token with spaces")

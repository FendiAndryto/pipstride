"""Build a ready-to-import MetaTrader 5 preset file for a connection.

The dashboard hands the trader a ``.set`` file next to the EA download, so the
terminal inputs are pre-filled: backend URL, the connection token (which is only
known at creation/rotation time), the watchlist, and the heartbeat cadence.

The token inside the file is a secret. It is written only to the response that
created it, never persisted in plaintext by the API.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.config import settings

EA_FILENAME = "PipstrideMonitor.mq5"

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")
_SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9._#-]{1,32}$")
_SAFE_TOKEN = re.compile(r"^[A-Za-z0-9._-]{8,128}$")


@dataclass(frozen=True)
class PresetFile:
    filename: str
    content: str
    backend_url: str


def sanitize_symbols(raw: str) -> str:
    symbols = []
    for candidate in (raw or "").split(","):
        cleaned = candidate.strip().upper()
        if cleaned and _SAFE_SYMBOL.match(cleaned):
            symbols.append(cleaned)
    return ",".join(dict.fromkeys(symbols))


def _safe_filename_part(value: str, fallback: str = "account") -> str:
    cleaned = _SAFE_NAME.sub("-", (value or "").strip()).strip("-.")
    return cleaned[:48] or fallback


def resolve_backend_url(request_base_url: str | None) -> str:
    """Prefer the explicit public URL; otherwise trust the inbound request origin."""
    configured = (settings.PUBLIC_BASE_URL or "").strip().rstrip("/")
    if configured:
        return configured
    if request_base_url:
        return request_base_url.rstrip("/")
    return "http://localhost:8089"


def build_preset(
    token: str,
    *,
    request_base_url: str | None = None,
    label: str = "Akun MT5",
) -> PresetFile:
    if not _SAFE_TOKEN.match(token or ""):
        raise ValueError("Refusing to build a preset with a malformed token")

    backend_url = resolve_backend_url(request_base_url)
    symbols = sanitize_symbols(settings.MT5_MONITORED_SYMBOLS) or "XAUUSD,EURUSD"
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    content = "\n".join(
        [
            "; PipstrideMonitor preset",
            f"; Connection: {label}",
            f"; Generated: {generated_at}",
            ";",
            "; This file contains a secret connection token. Do not share it.",
            "; Import it in MT5 via the EA Inputs tab -> Load, then click OK.",
            f"InpBackendUrl={backend_url}",
            f"InpBridgeToken={token}",
            f"InpMonitoredSymbols={symbols}",
            f"InpHistoryDays={int(settings.MT5_HISTORY_DAYS)}",
            f"InpHeartbeatInterval={max(1, int(settings.MT5_HEARTBEAT_INTERVAL_SECONDS))}",
            "InpVerboseLog=false",
            "",
        ]
    )

    filename = f"PipstrideMonitor_{_safe_filename_part(label)}.set"
    return PresetFile(filename=filename, content=content, backend_url=backend_url)

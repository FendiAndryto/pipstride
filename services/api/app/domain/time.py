"""Datetime normalisation shared by every layer.

PostgreSQL returns timezone-aware datetimes, SQLite returns naive ones. Mixing
the two raises ``TypeError`` on subtraction, so anything read back from the
database goes through here before being compared or converted.

The broker-day helpers exist because MT5 accounts roll over at midnight *server*
time (commonly UTC+2/+3, and UTC for some brokers), not UTC. Measuring a daily
drawdown on a UTC boundary resets the counter at 02:00-03:00 for the trader and
files late-evening deals under the wrong day (spec 003, ticket 09-01).

The offset must come from a *broker* clock, and MT5 offers two that are easy to
confuse:

``TimeCurrent()``
    The trade server clock — the one that defines the trading day.

``TimeLocal()``
    The wall clock of the PC running the terminal. A trader in Jakarta runs a
    UTC+7 machine against a UTC server, so trusting this value puts the day
    boundary 7 hours off and silently reintroduces the bug above. Heartbeats
    therefore carry the server clock separately, and the candle timestamps
    (always server time) act as an independent second opinion.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

# Broker offsets are whole 15-minute steps in practice (UTC+5:30 is a real
# case). Rounding to that grid absorbs the sub-second drift between the EA
# clock and ours without inventing a fake offset.
OFFSET_STEP_SECONDS = 900

# No real trading server sits further than +-14h from UTC. Clamping keeps a
# terminal with a badly set clock from moving the day boundary by days.
MAX_OFFSET_SECONDS = 14 * 3600


def as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def to_unix(value: Optional[datetime]) -> Optional[int]:
    normalised = as_utc(value)
    return int(normalised.timestamp()) if normalised else None


def broker_utc_offset_seconds(
    payload_timestamp: Optional[int],
    now_utc: datetime,
) -> int:
    """Offset between a *broker server* clock and UTC, in seconds.

    ``payload_timestamp`` must be ``TimeCurrent()``, which encodes the server
    clock. Passing ``TimeLocal()`` here measures the trader's PC instead and
    shifts the trading day by that PC's offset — see the module docstring.

    Missing or zero timestamps mean "unknown", which falls back to UTC so the
    dashboard keeps working with an old EA build.
    """
    if not payload_timestamp:
        return 0

    reference = as_utc(now_utc)
    if reference is None:
        return 0

    raw = int(payload_timestamp) - int(reference.timestamp())
    steps = round(raw / OFFSET_STEP_SECONDS)
    offset = steps * OFFSET_STEP_SECONDS
    return max(-MAX_OFFSET_SECONDS, min(MAX_OFFSET_SECONDS, offset))


def _bar_time(bar: Any) -> Optional[int]:
    """Read the open time of a candle in either the dict or the model shape."""
    if isinstance(bar, dict):
        value = bar.get("time")
    else:
        value = getattr(bar, "time", None)
    try:
        return int(value) if value else None
    except (TypeError, ValueError):
        return None


def broker_offset_from_bars(
    candles: Optional[Iterable[Any]],
    now_utc: datetime,
) -> Optional[int]:
    """Derive the broker offset from candle open times, which are server time.

    MT5 stamps ``MqlRates.time`` with the trade server clock, so the newest bar
    is a broker-clock reading that is independent of the terminal's own wall
    clock. That makes it the trustworthy fallback when the heartbeat does not
    carry ``TimeCurrent()`` (an older EA build) or when the value it carries is
    contradicted by the bars.

    Returns ``None`` when there is no usable bar: a closed bar can be up to one
    timeframe old, so only the day-level offset is recoverable, and a missing
    answer is better than a guessed one.
    """
    reference = as_utc(now_utc)
    if reference is None:
        return None

    times = [t for t in (_bar_time(bar) for bar in (candles or [])) if t]
    if not times:
        return None

    # The newest bar opens at or before the broker's "now", so the newest stamp
    # is the closest reading of the server clock we have.
    raw = max(times) - int(reference.timestamp())
    steps = round(raw / OFFSET_STEP_SECONDS)
    offset = steps * OFFSET_STEP_SECONDS
    return max(-MAX_OFFSET_SECONDS, min(MAX_OFFSET_SECONDS, offset))


def broker_day_start_utc(now_utc: datetime, offset_seconds: int) -> datetime:
    """Midnight of the current broker day, expressed in UTC.

    ``offset_seconds`` is broker-minus-UTC, so the broker clock reads
    ``now_utc + offset``. Truncating that to midnight and shifting back gives
    the boundary we compare trade close times against.
    """
    reference = as_utc(now_utc) or datetime.now(timezone.utc)
    broker_now = reference + timedelta(seconds=offset_seconds)
    broker_midnight = broker_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return broker_midnight - timedelta(seconds=offset_seconds)

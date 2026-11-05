"""Datetime normalisation shared by every layer.

PostgreSQL returns timezone-aware datetimes, SQLite returns naive ones. Mixing
the two raises ``TypeError`` on subtraction, so anything read back from the
database goes through here before being compared or converted.

The broker-day helpers exist because MT5 accounts roll over at midnight *server*
time (commonly UTC+2/+3), not UTC. Measuring a daily drawdown on a UTC boundary
resets the counter at 02:00-03:00 for the trader and files late-evening deals
under the wrong day (spec 003, ticket 09-01).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

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
    """Offset between the broker server clock and UTC, in seconds.

    The EA reports ``TimeCurrent()`` as a Unix timestamp, which encodes the
    *server* clock. Comparing it with our own UTC clock yields the offset.
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

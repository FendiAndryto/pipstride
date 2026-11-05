"""Datetime normalisation shared by every layer.

PostgreSQL returns timezone-aware datetimes, SQLite returns naive ones. Mixing
the two raises ``TypeError`` on subtraction, so anything read back from the
database goes through here before being compared or converted.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


def as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def to_unix(value: Optional[datetime]) -> Optional[int]:
    normalised = as_utc(value)
    return int(normalised.timestamp()) if normalised else None

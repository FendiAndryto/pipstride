"""Journal analytics computed from closed trades.

Everything here is derived from rows already stored in ``trades``; nothing is
invented and nothing is extrapolated. Timestamps are bucketed in UTC: the MT5
monitor reports deal times as the broker server clock encoded in a Unix
timestamp, so UTC buckets reproduce the server's own weekday/hour.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable, Iterable, Optional, Sequence

from app.db.models import Trade

WEEKDAY_LABELS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
RANGE_DAYS = {"1M": 30, "3M": 90, "1Y": 365}


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """PostgreSQL returns aware datetimes, SQLite returns naive ones."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def close_time(row: Trade) -> Optional[datetime]:
    return _as_utc(row.closed_at or row.opened_at or row.created_at)


def _hold_minutes(row: Trade) -> Optional[float]:
    opened, closed = _as_utc(row.opened_at), _as_utc(row.closed_at)
    if opened is None or closed is None:
        return None
    minutes = (closed - opened).total_seconds() / 60.0
    return minutes if minutes >= 0 else None


def _bucket(key: str, rows: Sequence[Trade]) -> dict:
    wins = [row.profit for row in rows if row.profit > 0]
    losses = [row.profit for row in rows if row.profit < 0]
    gross_profit = sum(wins)
    gross_loss = sum(losses)
    return {
        "key": key,
        "trades": len(rows),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / len(rows) * 100.0, 2) if rows else 0.0,
        "net_profit": round(gross_profit + gross_loss, 2),
        "profit_factor": round(gross_profit / abs(gross_loss), 2) if gross_loss else None,
    }


def _bucketize(
    rows: Sequence[Trade],
    key_fn: Callable[[Trade], Optional[str]],
    order: Optional[Sequence[str]] = None,
) -> list[dict]:
    grouped: dict[str, list[Trade]] = {}
    for row in rows:
        key = key_fn(row)
        if key is not None:
            grouped.setdefault(key, []).append(row)

    if order is not None:
        ordered = [key for key in order if key in grouped]
        ordered += sorted(key for key in grouped if key not in order)
    elif key_fn is _symbol_key:
        ordered = sorted(
            grouped,
            key=lambda key: (-sum(row.profit for row in grouped[key]), key),
        )
    else:
        ordered = sorted(grouped)

    return [_bucket(key, grouped[key]) for key in ordered]


def _symbol_key(row: Trade) -> Optional[str]:
    return (row.symbol or "").strip().upper() or None


def _weekday_key(row: Trade) -> Optional[str]:
    moment = close_time(row)
    return WEEKDAY_LABELS[moment.weekday()] if moment else None


def _hour_key(row: Trade) -> Optional[str]:
    moment = close_time(row)
    return f"{moment.hour:02d}" if moment else None


def _direction_key(row: Trade) -> Optional[str]:
    direction = (row.direction or "").strip().upper()
    return direction or None


def _source_key(row: Trade) -> Optional[str]:
    return "EA" if (row.magic or 0) > 0 else "Manual"


def compute_totals(rows: Sequence[Trade]) -> dict:
    profits = [row.profit for row in rows]
    wins = [p for p in profits if p > 0]
    losses = [p for p in profits if p < 0]
    gross_profit = sum(wins)
    gross_loss = sum(losses)
    total = len(rows)

    holds = [value for value in (_hold_minutes(row) for row in rows) if value is not None]

    max_win_streak = max_loss_streak = 0
    current_win = current_loss = 0
    for row in sorted(rows, key=lambda item: close_time(item) or datetime.min.replace(tzinfo=timezone.utc)):
        if row.profit > 0:
            current_win += 1
            current_loss = 0
        elif row.profit < 0:
            current_loss += 1
            current_win = 0
        else:
            current_win = current_loss = 0
        max_win_streak = max(max_win_streak, current_win)
        max_loss_streak = max(max_loss_streak, current_loss)

    avg_win = sum(wins) / len(wins) if wins else 0.0
    avg_loss = sum(losses) / len(losses) if losses else 0.0

    return {
        "trades": total,
        "wins": len(wins),
        "losses": len(losses),
        "breakeven": total - len(wins) - len(losses),
        "win_rate": round(len(wins) / total * 100.0, 2) if total else 0.0,
        "net_profit": round(gross_profit + gross_loss, 2),
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
        "profit_factor": round(gross_profit / abs(gross_loss), 2) if gross_loss else None,
        "expectancy": round((gross_profit + gross_loss) / total, 2) if total else 0.0,
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "payoff_ratio": round(avg_win / abs(avg_loss), 2) if avg_loss else None,
        "best_trade": round(max(profits), 2) if profits else 0.0,
        "worst_trade": round(min(profits), 2) if profits else 0.0,
        "max_win_streak": max_win_streak,
        "max_loss_streak": max_loss_streak,
        "avg_hold_minutes": round(sum(holds) / len(holds), 1) if holds else None,
        "total_volume": round(sum(row.volume or 0.0 for row in rows), 2),
    }


def compute_stats(rows: Iterable[Trade]) -> dict:
    rows = list(rows)
    return {
        "totals": compute_totals(rows),
        "by_symbol": _bucketize(rows, _symbol_key),
        "by_weekday": _bucketize(rows, _weekday_key, order=WEEKDAY_LABELS),
        "by_hour": _bucketize(rows, _hour_key, order=[f"{hour:02d}" for hour in range(24)]),
        "by_direction": _bucketize(rows, _direction_key, order=["BUY", "SELL"]),
        "by_source": _bucketize(rows, _source_key, order=["EA", "Manual"]),
    }

"""Closed-trade queries.

The journal route used to build this filter itself, which is why it imported
``sqlalchemy`` and the ``Trade`` model. Query shape lives here now.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Trade


def list_trades(
    db: Session,
    connection_id: str,
    *,
    since: Optional[datetime] = None,
    symbol: Optional[str] = None,
    direction: Optional[str] = None,
    source: str = "all",
) -> list[Trade]:
    """Return the trades matching the dashboard's journal filters.

    The EA may not report a close time for very old deals; fall back to the
    open time and finally to ingest time so a trade is never silently dropped.
    """
    moment = func.coalesce(Trade.closed_at, Trade.opened_at, Trade.created_at)

    conditions = [Trade.connection_id == connection_id]
    if since is not None:
        conditions.append(moment >= since)
    if symbol:
        conditions.append(func.upper(Trade.symbol) == symbol.strip().upper())
    if direction:
        conditions.append(func.upper(Trade.direction) == direction)
    if source == "ea":
        conditions.append(Trade.magic > 0)
    elif source == "manual":
        conditions.append(Trade.magic == 0)

    return list(db.scalars(select(Trade).where(*conditions)))


def sum_profit_between(
    db: Session,
    connection_id: str,
    *,
    after: Optional[datetime] = None,
    until: Optional[datetime] = None,
) -> float:
    """Net realized profit with ``after < closed_at <= until``.

    Used to roll a stale telemetry snapshot forward to a day boundary: the
    snapshot's balance is only valid up to its own timestamp (spec 003).
    Half-open on both ends so a trade is counted by exactly one window.
    """
    conditions = [Trade.connection_id == connection_id, Trade.closed_at.is_not(None)]
    if after is not None:
        conditions.append(Trade.closed_at > after)
    if until is not None:
        conditions.append(Trade.closed_at <= until)

    total = db.scalar(select(func.coalesce(func.sum(Trade.profit), 0.0)).where(*conditions))
    return round(float(total or 0.0), 2)


def profit_points(db: Session, connection_id: str) -> list[tuple[float, Optional[datetime]]]:
    """Every realized profit in close order with its close time.

    The overall drawdown needs the running equity curve *and* the moment the
    peak happened, so this returns ``(profit, closed_at)`` pairs instead of ORM
    rows (spec 003, ticket 09-02).
    """
    rows = db.execute(
        select(Trade.profit, Trade.closed_at)
        .where(Trade.connection_id == connection_id)
        .order_by(Trade.closed_at.asc().nulls_last(), Trade.id.asc())
    )
    return [(float(profit or 0.0), closed_at) for profit, closed_at in rows]

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

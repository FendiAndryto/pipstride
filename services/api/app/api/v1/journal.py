import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_active_connection
from app.db.base import get_db
from app.db.models import Mt5Connection, Trade
from app.models.journal import JournalStatsResponse
from app.services.journal_service import RANGE_DAYS, compute_stats

router = APIRouter(prefix="/journal", tags=["Journal"])


@router.get(
    "/stats",
    response_model=JournalStatsResponse,
    summary="Aggregated performance for the active account, computed from stored trades",
)
def journal_stats(
    period: str = Query("1M", alias="range", pattern="^(1M|3M|1Y|ALL)$"),
    source: str = Query("all", pattern="^(all|ea|manual)$"),
    symbol: Optional[str] = Query(None, max_length=32),
    direction: Optional[str] = Query(None, pattern="^(BUY|SELL)$"),
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=RANGE_DAYS[period]) if period in RANGE_DAYS else None

    # The EA may not report a close time for very old deals; fall back to the
    # open time and finally to ingest time so a trade is never silently dropped.
    moment = func.coalesce(Trade.closed_at, Trade.opened_at, Trade.created_at)

    conditions = [Trade.connection_id == connection.id]
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

    rows = list(db.scalars(select(Trade).where(*conditions)))
    stats = compute_stats(rows)

    return JournalStatsResponse(
        range=period,
        source=source,
        start=int(since.timestamp()) if since else None,
        end=int(time.time()),
        account_number=connection.account_number,
        server=connection.broker_server,
        **stats,
    )

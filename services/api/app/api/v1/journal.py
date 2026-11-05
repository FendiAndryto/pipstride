import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.deps import get_active_connection
from app.db.base import get_db
from app.db.models import Mt5Connection
from app.domain.metrics import RANGE_DAYS, compute_stats
from app.infrastructure.db.repositories import trade_repository
from app.models.journal import JournalStatsResponse

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
    db=Depends(get_db),
):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=RANGE_DAYS[period]) if period in RANGE_DAYS else None

    rows = trade_repository.list_trades(
        db,
        connection.id,
        since=since,
        symbol=symbol,
        direction=direction,
        source=source,
    )
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

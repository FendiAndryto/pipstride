from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.deps import get_active_connection
from app.db.base import get_db
from app.db.models import Mt5Connection
from app.domain.metrics import RANGE_DAYS, close_time, compute_stats
from app.domain.time import to_unix
from app.infrastructure.db.repositories import (
    cash_flow_repository,
    journal_repository,
    trade_repository,
)
from app.models.bridge import CashFlowItem, ClosedTradeItem
from app.models.journal import JournalRowsResponse, JournalStatsResponse

router = APIRouter(prefix="/journal", tags=["Journal"])
UnixBound = Annotated[int | None, Query(ge=-62_135_596_800, le=253_402_300_799)]
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _bounds(start: int | None, end: int | None) -> tuple[datetime | None, datetime | None]:
    if start is not None and end is not None and start >= end:
        raise HTTPException(status_code=422, detail="start must be earlier than end")
    return (
        EPOCH + timedelta(seconds=start) if start is not None else None,
        EPOCH + timedelta(seconds=end) if end is not None else None,
    )


@router.get("/rows", response_model=JournalRowsResponse)
def journal_rows(
    start: UnixBound = None,
    end: UnixBound = None,
    source: str = Query("all", pattern="^(all|ea|manual)$"),
    symbol: Optional[str] = Query(None, max_length=32),
    search: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=1000),
    offset: int = Query(0, ge=0, le=2**63 - 1),
    include_symbols: bool = Query(True),
    trades_only: bool = Query(False),
    connection: Mt5Connection = Depends(get_active_connection),
    db=Depends(get_db),
):
    since, before = _bounds(start, end)
    trades, cash_flow, total, trade_total = journal_repository.list_rows(
        db,
        connection.id,
        since=since,
        before=before,
        source=source,
        symbol=symbol.strip() if symbol else None,
        search=search,
        trades_only=trades_only,
        limit=limit,
        offset=offset,
    )
    symbols = (
        journal_repository.list_symbols(db, connection.id, since=since, before=before)
        if include_symbols
        else []
    )
    return JournalRowsResponse(
        trades=[
            ClosedTradeItem(
                ticket=row.ticket,
                symbol=row.symbol,
                type=row.direction,
                volume=row.volume,
                open_price=row.open_price,
                close_price=row.close_price,
                profit=row.profit,
                open_time=to_unix(row.opened_at) or 0,
                close_time=to_unix(close_time(row)) or 0,
                magic=row.magic,
            )
            for row in trades
        ],
        cash_flow=[
            CashFlowItem(
                ticket=row.ticket,
                category=row.category,
                profit=row.amount,
                time=to_unix(row.occurred_at) or 0,
            )
            for row in cash_flow
        ],
        total=total,
        trade_total=trade_total,
        symbols=symbols,
    )


@router.get(
    "/stats",
    response_model=JournalStatsResponse,
    response_model_exclude_unset=True,
    summary="Aggregated performance for the active account, computed from stored trades",
)
def journal_stats(
    period: str = Query("1M", alias="range", pattern="^(MONTH|1M|3M|1Y|ALL)$"),
    source: str = Query("all", pattern="^(all|ea|manual)$"),
    symbol: Optional[str] = Query(None, max_length=32),
    direction: Optional[str] = Query(None, pattern="^(BUY|SELL)$"),
    start: UnixBound = None,
    end: UnixBound = None,
    include_daily: bool = Query(False),
    connection: Mt5Connection = Depends(get_active_connection),
    db=Depends(get_db),
):
    now = datetime.now(timezone.utc)
    if period == "MONTH" and (start is None or end is None):
        raise HTTPException(status_code=422, detail="MONTH requires start and end")
    since, before = _bounds(start, end)
    if start is None and end is None and period in RANGE_DAYS:
        since = now - timedelta(days=RANGE_DAYS[period])

    rows = trade_repository.list_trades(
        db,
        connection.id,
        since=since,
        before=before,
        symbol=symbol,
        direction=direction,
        source=source,
    )
    stats = compute_stats(rows, include_daily=include_daily)
    cash_flow = cash_flow_repository.journal_totals(
        db, connection.id, since=since, before=before
    )

    return JournalStatsResponse(
        range=period,
        source=source,
        start=to_unix(since),
        end=to_unix(before if before is not None else now),
        account_number=connection.account_number,
        server=connection.broker_server,
        cash_flow=cash_flow,
        **stats,
    )

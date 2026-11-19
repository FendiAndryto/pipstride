"""Paged reads across the journal's trade and cash streams."""

from datetime import datetime

from sqlalchemy import String, and_, case, cast, func, literal, or_, select, true, union_all
from sqlalchemy.orm import Session

from app.db.models import CashFlowDeal, Trade
from app.infrastructure.db.repositories import cash_flow_repository, trade_repository
from app.infrastructure.db.repositories.trade_repository import TRADE_MOMENT, TRADE_SYMBOL

TRADE = 0
CASH = 1


def list_rows(
    db: Session,
    connection_id: str,
    *,
    since: datetime | None,
    before: datetime | None,
    source: str,
    symbol: str | None,
    search: str | None,
    trades_only: bool,
    limit: int,
    offset: int,
) -> tuple[list[Trade], list[CashFlowDeal], int, int]:
    trade_conditions = trade_repository.trade_scope(
        connection_id, since=since, before=before, source=source, symbol=symbol
    )
    cash_conditions = cash_flow_repository.journal_scope(connection_id, since, before)
    if search:
        needle = search.lower()
        trade_source = case((Trade.magic > 0, "ea"), else_="manual")
        trade_conditions.append(
            or_(
                func.lower(Trade.symbol).contains(needle, autoescape=True),
                func.lower(Trade.direction).contains(needle, autoescape=True),
                trade_source.contains(needle, autoescape=True),
                cast(Trade.ticket, String).contains(needle, autoescape=True),
            )
        )
        cash_conditions.append(
            or_(
                func.lower(CashFlowDeal.category).contains(needle, autoescape=True),
                cast(CashFlowDeal.ticket, String).contains(needle, autoescape=True),
            )
        )

    trade_keys = select(
        Trade.id, TRADE_MOMENT.label("moment"), literal(TRADE).label("kind")
    ).where(*trade_conditions)
    matching_keys = trade_keys
    if source == "all" and not symbol and not trades_only:
        cash_keys = select(
            CashFlowDeal.id, CashFlowDeal.occurred_at, literal(CASH)
        ).where(*cash_conditions)
        matching_keys = union_all(trade_keys, cash_keys)

    matches = matching_keys.subquery()
    page = (
        select(matches)
        .order_by(matches.c.moment.desc(), matches.c.kind, matches.c.id.desc())
        .limit(limit)
        .offset(offset)
        .subquery()
    )
    counts = select(
        func.count().label("total"),
        func.count().filter(matches.c.kind == TRADE).label("trade_total"),
    ).select_from(matches).subquery()
    # Start from counts so an empty page still returns the filtered totals.
    rows = db.execute(
        select(Trade, CashFlowDeal, counts.c.total, counts.c.trade_total)
        .select_from(counts)
        .outerjoin(page, true())
        .outerjoin(Trade, and_(page.c.kind == TRADE, page.c.id == Trade.id))
        .outerjoin(CashFlowDeal, and_(page.c.kind == CASH, page.c.id == CashFlowDeal.id))
        .order_by(page.c.moment.desc(), page.c.kind, page.c.id.desc())
    ).all()
    trades = [trade for trade, _, _, _ in rows if trade is not None]
    cash_flow = [deal for _, deal, _, _ in rows if deal is not None]
    return trades, cash_flow, rows[0].total, rows[0].trade_total


def list_symbols(
    db: Session, connection_id: str, *, since: datetime | None, before: datetime | None
) -> list[dict]:
    scope = trade_repository.trade_scope(connection_id, since=since, before=before)
    count = func.count()
    rows = db.execute(
        select(TRADE_SYMBOL, count)
        .where(*scope, TRADE_SYMBOL != "")
        .group_by(TRADE_SYMBOL)
        .order_by(count.desc(), TRADE_SYMBOL)
    )
    return [{"symbol": symbol, "count": count} for symbol, count in rows]

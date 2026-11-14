"""Cash flow (deposit / withdrawal) persistence and reads.

Balance deals live in ``cash_flow_deals`` and never touch ``trades``. Payload
items are duck-typed on the bridge DTO fields (``ticket``, ``category``,
``profit``, ``time``), so this module imports no Pydantic model.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session

from app.db.models import CashFlowDeal

DEPOSIT = "DEPOSIT"
WITHDRAWAL = "WITHDRAWAL"


def _to_dt(timestamp: Optional[int]) -> datetime:
    if not timestamp:
        return datetime.now(timezone.utc)
    return datetime.fromtimestamp(int(timestamp), tz=timezone.utc)


def existing_cash_flow_tickets(
    db: Session, connection_id: str, tickets: list[int], chunk_size: int
) -> set:
    existing: set = set()
    for start in range(0, len(tickets), chunk_size):
        existing.update(
            db.scalars(
                select(CashFlowDeal.ticket).where(
                    CashFlowDeal.connection_id == connection_id,
                    CashFlowDeal.ticket.in_(tickets[start : start + chunk_size]),
                )
            )
        )
    return existing


def insert_cash_flow(db: Session, connection_id: str, items: Iterable[Any]) -> None:
    db.bulk_save_objects(
        [
            CashFlowDeal(
                connection_id=connection_id,
                ticket=item.ticket,
                category=item.category,
                amount=item.profit,
                occurred_at=_to_dt(item.time),
            )
            for item in items
        ]
    )


def list_cash_flow(
    db: Session,
    connection_id: str,
    *,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    limit: int = 1000,
    offset: int = 0,
) -> list[CashFlowDeal]:
    conditions = [CashFlowDeal.connection_id == connection_id]
    if since is not None:
        conditions.append(CashFlowDeal.occurred_at >= since)
    if until is not None:
        conditions.append(CashFlowDeal.occurred_at <= until)
    return list(
        db.scalars(
            select(CashFlowDeal)
            .where(*conditions)
            .order_by(CashFlowDeal.occurred_at.desc(), CashFlowDeal.id.desc())
            .limit(max(1, min(int(limit or 1000), 5000)))
            .offset(max(0, int(offset or 0)))
        )
    )


def sum_cash_flow(
    db: Session,
    connection_id: str,
    *,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
) -> dict:
    """Deposits and withdrawals in a window, withdrawals reported as positive."""
    conditions = [CashFlowDeal.connection_id == connection_id]
    if since is not None:
        conditions.append(CashFlowDeal.occurred_at >= since)
    if until is not None:
        conditions.append(CashFlowDeal.occurred_at <= until)

    row = db.execute(
        select(
            func.coalesce(
                func.sum(
                    case((CashFlowDeal.amount > 0, CashFlowDeal.amount), else_=0.0)
                ),
                0.0,
            ),
            func.coalesce(
                func.sum(
                    case((CashFlowDeal.amount < 0, CashFlowDeal.amount), else_=0.0)
                ),
                0.0,
            ),
        ).where(*conditions)
    ).one()

    deposits = round(float(row[0] or 0.0), 2)
    withdrawals = round(abs(float(row[1] or 0.0)), 2)
    return {
        "deposits": deposits,
        "withdrawals": withdrawals,
        "net_funding": round(deposits - withdrawals, 2),
    }


def earliest_deposit(db: Session, connection_id: str) -> Optional[CashFlowDeal]:
    """Oldest positive balance deal.

    That deal is what the sensor reports as ``initial_deposit``, so the equity
    reconstruction uses it as the baseline and must not apply it a second time
    as an event.
    """
    return db.scalar(
        select(CashFlowDeal)
        .where(
            CashFlowDeal.connection_id == connection_id,
            CashFlowDeal.amount > 0,
        )
        .order_by(CashFlowDeal.occurred_at.asc(), CashFlowDeal.id.asc())
        .limit(1)
    )


def cash_flow_events(
    db: Session, connection_id: str
) -> list[tuple[int, float, datetime]]:
    """Every cash movement as ``(id, amount, occurred_at)`` in time order."""
    rows = db.execute(
        select(CashFlowDeal.id, CashFlowDeal.amount, CashFlowDeal.occurred_at)
        .where(CashFlowDeal.connection_id == connection_id)
        .order_by(CashFlowDeal.occurred_at.asc(), CashFlowDeal.id.asc())
    )
    return [(int(row[0]), float(row[1] or 0.0), row[2]) for row in rows]


def delete_for_connection(db: Session, connection_id: str) -> None:
    db.execute(delete(CashFlowDeal).where(CashFlowDeal.connection_id == connection_id))

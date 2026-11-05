"""Snapshot and trade persistence for telemetry ingest.

Trade payloads are duck-typed on the fields the bridge DTO already exposes, so
this module does not import the Pydantic layer.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import TelemetrySnapshot, Trade


def _to_dt(timestamp: Optional[int]) -> Optional[datetime]:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(int(timestamp), tz=timezone.utc)


def latest_snapshot_at(db: Session, connection_id: str) -> Optional[datetime]:
    """Index-only lookup of the newest snapshot for a connection."""
    return db.scalar(
        select(TelemetrySnapshot.captured_at)
        .where(TelemetrySnapshot.connection_id == connection_id)
        .order_by(TelemetrySnapshot.captured_at.desc())
        .limit(1)
    )


def balance_at_or_before(db: Session, connection_id: str, moment: datetime) -> Optional[float]:
    return db.scalar(
        select(TelemetrySnapshot.balance)
        .where(
            TelemetrySnapshot.connection_id == connection_id,
            TelemetrySnapshot.captured_at <= moment,
        )
        .order_by(TelemetrySnapshot.captured_at.desc())
        .limit(1)
    )


def insert_snapshot(db: Session, connection_id: str, payload: Any) -> None:
    db.add(
        TelemetrySnapshot(
            connection_id=connection_id,
            balance=payload.balance,
            equity=payload.equity,
            margin=payload.margin,
            free_margin=payload.free_margin,
            margin_level=payload.margin_level,
            floating_pnl=payload.floating_pnl,
            open_positions=payload.open_positions,
        )
    )


def existing_tickets(db: Session, connection_id: str, tickets: list[int], chunk_size: int) -> set:
    """Fetch only the tickets present in this payload, chunked."""
    existing: set = set()
    for start in range(0, len(tickets), chunk_size):
        existing.update(
            db.scalars(
                select(Trade.ticket).where(
                    Trade.connection_id == connection_id,
                    Trade.ticket.in_(tickets[start : start + chunk_size]),
                )
            )
        )
    return existing


def insert_trades(db: Session, connection_id: str, items: Iterable[Any]) -> None:
    db.bulk_save_objects(
        [
            Trade(
                connection_id=connection_id,
                ticket=item.ticket,
                symbol=item.symbol,
                direction=item.type,
                volume=item.volume,
                open_price=item.open_price,
                close_price=item.close_price,
                profit=item.profit,
                magic=item.magic,
                opened_at=_to_dt(item.open_time),
                closed_at=_to_dt(item.close_time),
            )
            for item in items
        ]
    )


def count_trades(db: Session, connection_id: str) -> int:
    return int(
        db.scalar(select(func.count(Trade.id)).where(Trade.connection_id == connection_id)) or 0
    )


def delete_trades_and_snapshots(db: Session, connection_id: str) -> None:
    """Bulk reset of one connection's journal (SQLAlchemy 2.0 ``delete``)."""
    db.execute(delete(Trade).where(Trade.connection_id == connection_id))
    db.execute(delete(TelemetrySnapshot).where(TelemetrySnapshot.connection_id == connection_id))

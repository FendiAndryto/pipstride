"""MT5 connection queries and inserts."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Mt5Connection


def list_active(db: Session, user_id: str) -> list[Mt5Connection]:
    return list(
        db.scalars(
            select(Mt5Connection)
            .where(Mt5Connection.user_id == user_id, Mt5Connection.revoked_at.is_(None))
            .order_by(Mt5Connection.created_at)
        )
    )


def get_active(db: Session, user_id: str, connection_id: str) -> Optional[Mt5Connection]:
    return db.scalar(
        select(Mt5Connection).where(
            Mt5Connection.id == connection_id,
            Mt5Connection.user_id == user_id,
            Mt5Connection.revoked_at.is_(None),
        )
    )


def get_by_token_hash(db: Session, token_hash: str) -> Optional[Mt5Connection]:
    connection = db.scalar(
        select(Mt5Connection).where(Mt5Connection.token_hash == token_hash)
    )
    if connection is None or connection.revoked_at is not None:
        return None
    return connection


def get_conflicting_account(
    db: Session, user_id: str, account_number: int, exclude_id: str
) -> Optional[Mt5Connection]:
    """An active connection already bound to the same MT5 account."""
    return db.scalar(
        select(Mt5Connection).where(
            Mt5Connection.user_id == user_id,
            Mt5Connection.account_number == account_number,
            Mt5Connection.id != exclude_id,
            Mt5Connection.revoked_at.is_(None),
        )
    )


def add(db: Session, connection: Mt5Connection) -> None:
    db.add(connection)

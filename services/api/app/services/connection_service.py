"""Connection lifecycle: token issuing, rotation, binding and revocation.

Each MT5 terminal gets its own connection record and its own token. Tokens are
stored as SHA-256 digests only; the raw value is returned exactly once, when the
connection is created or rotated.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import live_state
from app.core.tokens import generate_token, hash_token, token_display_prefix
from app.db.models import AuditLog, Entitlement, Mt5Connection, User


class ConnectionLimitReached(Exception):
    pass


class ConnectionBindingError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _audit(db: Session, user_id: str, action: str, connection_id: Optional[str] = None, detail: Optional[str] = None) -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            connection_id=connection_id,
            action=action,
            detail=detail,
        )
    )


class ConnectionService:
    def list_connections(self, db: Session, user_id: str) -> list[Mt5Connection]:
        return list(
            db.scalars(
                select(Mt5Connection)
                .where(Mt5Connection.user_id == user_id, Mt5Connection.revoked_at.is_(None))
                .order_by(Mt5Connection.created_at)
            )
        )

    def get_connection(self, db: Session, user_id: str, connection_id: str) -> Optional[Mt5Connection]:
        return db.scalar(
            select(Mt5Connection).where(
                Mt5Connection.id == connection_id,
                Mt5Connection.user_id == user_id,
                Mt5Connection.revoked_at.is_(None),
            )
        )

    def get_by_token(self, db: Session, raw_token: str) -> Optional[Mt5Connection]:
        if not raw_token or not raw_token.strip():
            return None
        conn = db.scalar(
            select(Mt5Connection).where(Mt5Connection.token_hash == hash_token(raw_token))
        )
        if conn is None or conn.revoked_at is not None:
            return None
        return conn

    def _active_count(self, db: Session, user_id: str) -> int:
        return len(self.list_connections(db, user_id))

    def _max_connections(self, db: Session, user_id: str) -> int:
        ent = db.get(Entitlement, user_id)
        return ent.max_connections if ent else 1

    def create_connection(
        self,
        db: Session,
        user: User,
        label: str = "Akun MT5",
    ) -> tuple[Mt5Connection, str]:
        if self._active_count(db, user.id) >= self._max_connections(db, user.id):
            raise ConnectionLimitReached(
                "Batas jumlah akun MT5 untuk paket Anda sudah tercapai. "
                "Hapus koneksi lama atau tingkatkan paket."
            )

        raw = generate_token()
        conn = Mt5Connection(
            user_id=user.id,
            label=label.strip()[:64] or "Akun MT5",
            token_hash=hash_token(raw),
            token_prefix=token_display_prefix(raw),
            status="pending",
        )
        db.add(conn)
        db.flush()
        _audit(db, user.id, "connection.created", conn.id, label)
        db.commit()
        db.refresh(conn)
        return conn, raw

    def rotate_token(self, db: Session, user: User, connection: Mt5Connection) -> tuple[Mt5Connection, str]:
        raw = generate_token()
        connection.token_hash = hash_token(raw)
        connection.token_prefix = token_display_prefix(raw)
        connection.status = "pending"
        connection.bound_at = None
        connection.account_number = None
        connection.broker_server = None
        connection.last_seen_at = None
        live_state.clear_live_payload(connection.id)
        _audit(db, user.id, "connection.token_rotated", connection.id)
        db.commit()
        db.refresh(connection)
        return connection, raw

    def revoke_connection(self, db: Session, user: User, connection: Mt5Connection) -> None:
        connection.revoked_at = _now()
        connection.status = "revoked"
        live_state.clear_live_payload(connection.id)
        _audit(db, user.id, "connection.revoked", connection.id)
        db.commit()

    def bind_account(
        self,
        db: Session,
        connection: Mt5Connection,
        account_number: int,
        broker_server: str,
        currency: Optional[str] = None,
    ) -> None:
        """First-connect binding lock.

        A token is permanently tied to the first MT5 account it reports. Any
        later heartbeat claiming a different account is rejected so a leaked
        token cannot be pointed at another trading account.
        """
        conflict = db.scalar(
            select(Mt5Connection).where(
                Mt5Connection.user_id == connection.user_id,
                Mt5Connection.account_number == account_number,
                Mt5Connection.id != connection.id,
                Mt5Connection.revoked_at.is_(None),
            )
        )
        if conflict is not None:
            raise ConnectionBindingError(
                f"Akun {account_number} sudah terhubung lewat koneksi "
                f"'{conflict.label}'. Hapus koneksi lama terlebih dahulu."
            )

        if connection.account_number is None:
            connection.account_number = account_number
            connection.broker_server = broker_server
            connection.account_currency = currency
            connection.bound_at = _now()
            connection.status = "connected"
            _audit(
                db,
                connection.user_id,
                "connection.bound",
                connection.id,
                f"{account_number}@{broker_server}",
            )
            return

        if connection.account_number != account_number:
            raise ConnectionBindingError(
                "Token ini sudah terikat ke akun MT5 lain "
                f"({connection.account_number}). Lakukan reset binding untuk mengganti akun."
            )

        connection.status = "connected"
        if broker_server and connection.broker_server != broker_server:
            connection.broker_server = broker_server


connection_service = ConnectionService()

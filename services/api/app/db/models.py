import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


# SQLite only auto-increments a column declared exactly as INTEGER PRIMARY KEY,
# so BIGINT primary keys get an INTEGER variant there. PostgreSQL keeps BIGINT.
BIGINT_PK = BigInteger().with_variant(Integer, "sqlite")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Optional so existing installs keep working; required for password recovery.
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="trader")
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    connections: Mapped[list["Mt5Connection"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    entitlement: Mapped["Entitlement | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )

    __table_args__ = (UniqueConstraint("email", name="uq_users_email"),)


class AuthToken(Base):
    """Single-use email token for password reset or address verification.

    Only the SHA-256 digest is stored; the raw token lives exclusively in the
    emailed link. Issuing a new token for the same purpose burns older ones so
    an old link cannot be replayed after a newer request.
    """

    __tablename__ = "auth_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("ix_auth_tokens_user_purpose", "user_id", "purpose"),)


class Mt5Connection(Base):
    """A single MT5 terminal binding owned by one user.

    Tokens are never stored in plaintext: only the SHA-256 digest and a short
    display prefix are persisted. The raw token is shown exactly once, at
    creation or rotation time.
    """

    __tablename__ = "mt5_connections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(64), nullable=False, default="Akun MT5")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    token_prefix: Mapped[str] = mapped_column(String(24), nullable=False)
    account_number: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    broker_server: Mapped[str | None] = mapped_column(String(128), nullable=True)
    account_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    bound_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    user: Mapped[User] = relationship(back_populates="connections")
    settings: Mapped["AccountSettings | None"] = relationship(
        back_populates="connection", cascade="all, delete-orphan", uselist=False
    )

    __table_args__ = (
        # Uniqueness of (user_id, account_number) is enforced in the service
        # layer for *active* connections only, so a revoked connection can be
        # replaced by a fresh one for the same MT5 account.
        Index("ix_connections_status", "status"),
    )


class AccountSettings(Base):
    """Per-connection analytical settings (never broker transactions)."""

    __tablename__ = "account_settings"

    connection_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("mt5_connections.id", ondelete="CASCADE"), primary_key=True
    )
    custom_initial_deposit: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    connection: Mapped[Mt5Connection] = relationship(back_populates="settings")


class TelemetrySnapshot(Base):
    __tablename__ = "telemetry_snapshots"

    id: Mapped[int] = mapped_column(BIGINT_PK, primary_key=True, autoincrement=True)
    connection_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("mt5_connections.id", ondelete="CASCADE"), nullable=False
    )
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    balance: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    equity: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    margin: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    free_margin: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    margin_level: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    floating_pnl: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    open_positions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (Index("ix_snapshots_connection_time", "connection_id", "captured_at"),)


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(BIGINT_PK, primary_key=True, autoincrement=True)
    connection_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("mt5_connections.id", ondelete="CASCADE"), nullable=False
    )
    ticket: Mapped[int] = mapped_column(BigInteger, nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    volume: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    open_price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    close_price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    profit: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    magic: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        UniqueConstraint("connection_id", "ticket", name="uq_trade_connection_ticket"),
        Index("ix_trades_connection_closed", "connection_id", "closed_at"),
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BIGINT_PK, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    connection_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class Plan(Base):
    __tablename__ = "plans"

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    max_connections: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Entitlement(Base):
    __tablename__ = "entitlements"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    plan_code: Mapped[str] = mapped_column(
        String(32), ForeignKey("plans.code"), nullable=False, default="free"
    )
    max_connections: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    user: Mapped[User] = relationship(back_populates="entitlement")

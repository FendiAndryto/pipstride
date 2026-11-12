"""Read models for the admin console.

These queries join across ``users``, ``entitlements``, ``mt5_connections``,
``trades`` and ``audit_logs`` on the same database (ADR 0008 §1). They are
read-only by construction; every write lives in ``admin_service`` so the audit
trail cannot be forgotten next to a ``db.commit()``.

The projections never select ``mt5_connections.token_hash``: ``token_prefix``
is the only token-derived value the console may show (ADR 0008 §6).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.db.models import (
    AccountSettings,
    AuditLog,
    Entitlement,
    Mt5Connection,
    SupportSession,
    Trade,
    User,
)
from app.domain.time import as_utc


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _user_rollups():
    """Per-user connection and trade aggregates, computed in SQL."""
    per_connection_trades = (
        select(
            Trade.connection_id.label("connection_id"),
            func.count(Trade.id).label("trade_count"),
            func.max(func.coalesce(Trade.closed_at, Trade.opened_at)).label(
                "last_trade_at"
            ),
        )
        .group_by(Trade.connection_id)
        .subquery()
    )
    user_trades = (
        select(
            Mt5Connection.user_id.label("user_id"),
            func.coalesce(func.sum(per_connection_trades.c.trade_count), 0).label(
                "trade_count"
            ),
            func.max(per_connection_trades.c.last_trade_at).label("last_trade_at"),
        )
        .join(
            per_connection_trades,
            per_connection_trades.c.connection_id == Mt5Connection.id,
        )
        .group_by(Mt5Connection.user_id)
        .subquery()
    )
    user_connections = (
        select(
            Mt5Connection.user_id.label("user_id"),
            func.count(Mt5Connection.id).label("connection_count"),
            func.coalesce(
                func.sum(case((Mt5Connection.revoked_at.is_(None), 1), else_=0)), 0
            ).label("active_connection_count"),
            func.max(Mt5Connection.last_seen_at).label("last_seen_at"),
        )
        .group_by(Mt5Connection.user_id)
        .subquery()
    )
    return user_connections, user_trades


def _user_select():
    user_connections, user_trades = _user_rollups()
    return (
        select(
            User,
            Entitlement.plan_code,
            Entitlement.max_connections,
            user_connections.c.connection_count,
            user_connections.c.active_connection_count,
            user_connections.c.last_seen_at,
            user_trades.c.trade_count,
            user_trades.c.last_trade_at,
        )
        .outerjoin(Entitlement, Entitlement.user_id == User.id)
        .outerjoin(user_connections, user_connections.c.user_id == User.id)
        .outerjoin(user_trades, user_trades.c.user_id == User.id)
    )


def _user_dict(row) -> dict:
    (
        user,
        plan_code,
        max_connections,
        connection_count,
        active_connection_count,
        last_seen_at,
        trade_count,
        last_trade_at,
    ) = row
    return {
        "user": user,
        "plan_code": plan_code or "free",
        "max_connections": max_connections if max_connections is not None else 1,
        "connection_count": int(connection_count or 0),
        "active_connection_count": int(active_connection_count or 0),
        "last_seen_at": last_seen_at,
        "trade_count": int(trade_count or 0),
        "last_trade_at": last_trade_at,
    }


def list_users(
    db: Session,
    *,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    filters = []
    if search and search.strip():
        pattern = f"%{search.strip().lower()}%"
        filters.append(
            or_(
                func.lower(User.username).like(pattern),
                func.lower(func.coalesce(User.email, "")).like(pattern),
            )
        )

    total = db.scalar(select(func.count()).select_from(User).where(*filters)) or 0
    rows = db.execute(
        _user_select()
        .where(*filters)
        .order_by(User.created_at.desc(), User.username)
        .limit(limit)
        .offset(offset)
    ).all()
    return [_user_dict(row) for row in rows], int(total)


def get_user(db: Session, user_id: str) -> Optional[dict]:
    row = db.execute(_user_select().where(User.id == user_id)).first()
    return _user_dict(row) if row is not None else None


def _connection_select():
    per_connection_trades = (
        select(
            Trade.connection_id.label("connection_id"),
            func.count(Trade.id).label("trade_count"),
        )
        .group_by(Trade.connection_id)
        .subquery()
    )
    return (
        select(Mt5Connection, User.username, per_connection_trades.c.trade_count)
        .outerjoin(User, User.id == Mt5Connection.user_id)
        .outerjoin(
            per_connection_trades,
            per_connection_trades.c.connection_id == Mt5Connection.id,
        )
    )


def _connection_dict(row) -> dict:
    connection, username, trade_count = row
    return {
        "connection": connection,
        "username": username,
        "trade_count": int(trade_count or 0),
    }


def list_connections(
    db: Session,
    *,
    status: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict], int]:
    filters = []
    if user_id:
        filters.append(Mt5Connection.user_id == user_id)
    if status == "revoked":
        filters.append(Mt5Connection.revoked_at.is_not(None))
    elif status == "active":
        filters.append(Mt5Connection.revoked_at.is_(None))
    elif status:
        filters.append(Mt5Connection.status == status)

    total = (
        db.scalar(select(func.count()).select_from(Mt5Connection).where(*filters)) or 0
    )
    rows = db.execute(
        _connection_select()
        .where(*filters)
        .order_by(Mt5Connection.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [_connection_dict(row) for row in rows], int(total)


def get_connection(db: Session, connection_id: str) -> Optional[dict]:
    row = db.execute(
        _connection_select().where(Mt5Connection.id == connection_id)
    ).first()
    return _connection_dict(row) if row is not None else None


def list_audit(
    db: Session,
    *,
    user_id: Optional[str] = None,
    target_user_id: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict], int]:
    actor = aliased(User)
    target = aliased(User)
    filters = []
    if user_id:
        filters.append(
            or_(AuditLog.user_id == user_id, AuditLog.target_user_id == user_id)
        )
    if target_user_id:
        filters.append(AuditLog.target_user_id == target_user_id)
    if action:
        filters.append(AuditLog.action == action)

    total = db.scalar(select(func.count()).select_from(AuditLog).where(*filters)) or 0
    rows = db.execute(
        select(AuditLog, actor.username, target.username)
        .outerjoin(actor, actor.id == AuditLog.user_id)
        .outerjoin(target, target.id == AuditLog.target_user_id)
        .where(*filters)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    items = []
    for log, actor_username, target_username in rows:
        items.append(
            {
                "log": log,
                "actor_username": actor_username,
                "target_username": target_username,
            }
        )
    return items, int(total)


def metrics(db: Session) -> dict:
    now = _now()
    last_day = now - timedelta(hours=24)

    user_total = db.scalar(select(func.count()).select_from(User)) or 0
    user_active = (
        db.scalar(
            select(func.count()).select_from(User).where(User.is_active.is_(True))
        )
        or 0
    )
    roles = dict(db.execute(select(User.role, func.count()).group_by(User.role)).all())

    connection_total = db.scalar(select(func.count()).select_from(Mt5Connection)) or 0
    connection_active = (
        db.scalar(
            select(func.count())
            .select_from(Mt5Connection)
            .where(Mt5Connection.revoked_at.is_(None))
        )
        or 0
    )
    connection_statuses = dict(
        db.execute(
            select(Mt5Connection.status, func.count()).group_by(Mt5Connection.status)
        ).all()
    )

    trade_total = db.scalar(select(func.count()).select_from(Trade)) or 0
    trade_last_day = (
        db.scalar(
            select(func.count())
            .select_from(Trade)
            .where(func.coalesce(Trade.closed_at, Trade.created_at) >= last_day)
        )
        or 0
    )

    audit_total = db.scalar(select(func.count()).select_from(AuditLog)) or 0
    audit_last_day = (
        db.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.created_at >= last_day)
        )
        or 0
    )

    support_active = (
        db.scalar(
            select(func.count())
            .select_from(SupportSession)
            .where(
                SupportSession.revoked_at.is_(None),
                SupportSession.expires_at > now,
            )
        )
        or 0
    )

    return {
        "users": {
            "total": int(user_total),
            "active": int(user_active),
            "admins": int(roles.get("admin", 0)),
            "support": int(roles.get("support", 0)),
            "traders": int(roles.get("trader", 0)),
        },
        "connections": {
            "total": int(connection_total),
            "active": int(connection_active),
            "connected": int(connection_statuses.get("connected", 0)),
            "pending": int(connection_statuses.get("pending", 0)),
            "revoked": int(connection_statuses.get("revoked", 0)),
        },
        "trades": {"total": int(trade_total), "last_24h": int(trade_last_day)},
        "audit_logs": {"total": int(audit_total), "last_24h": int(audit_last_day)},
        "support_sessions": {"active": int(support_active)},
    }


def list_support_sessions(
    db: Session,
    *,
    admin_id: Optional[str] = None,
    active_only: bool = False,
    limit: int = 50,
) -> list[dict]:
    filters = []
    if admin_id:
        filters.append(SupportSession.admin_id == admin_id)
    if active_only:
        filters.extend(
            [
                SupportSession.revoked_at.is_(None),
                SupportSession.expires_at > _now(),
            ]
        )

    admin = aliased(User)
    target = aliased(User)
    rows = db.execute(
        select(SupportSession, admin.username, target.username)
        .outerjoin(admin, admin.id == SupportSession.admin_id)
        .outerjoin(target, target.id == SupportSession.target_user_id)
        .where(*filters)
        .order_by(SupportSession.granted_at.desc())
        .limit(limit)
    ).all()
    return [
        {
            "session": session,
            "admin_username": admin_username,
            "target_username": target_username,
        }
        for session, admin_username, target_username in rows
    ]


def get_support_session(db: Session, session_id: str) -> Optional[dict]:
    admin = aliased(User)
    target = aliased(User)
    row = db.execute(
        select(SupportSession, admin.username, target.username)
        .outerjoin(admin, admin.id == SupportSession.admin_id)
        .outerjoin(target, target.id == SupportSession.target_user_id)
        .where(SupportSession.id == session_id)
    ).first()
    if row is None:
        return None
    session, admin_username, target_username = row
    return {
        "session": session,
        "admin_username": admin_username,
        "target_username": target_username,
    }


def find_active_support_session(
    db: Session, *, admin_id: str, target_user_id: str
) -> Optional[SupportSession]:
    return db.scalar(
        select(SupportSession)
        .where(
            SupportSession.admin_id == admin_id,
            SupportSession.target_user_id == target_user_id,
            SupportSession.revoked_at.is_(None),
            SupportSession.expires_at > _now(),
        )
        .order_by(SupportSession.granted_at.desc())
    )


def list_trades_for_user(db: Session, user_id: str, limit: int = 200) -> list[Trade]:
    return list(
        db.scalars(
            select(Trade)
            .join(Mt5Connection, Mt5Connection.id == Trade.connection_id)
            .where(Mt5Connection.user_id == user_id)
            .order_by(func.coalesce(Trade.closed_at, Trade.opened_at).desc())
            .limit(limit)
        )
    )


def list_account_settings_for_user(db: Session, user_id: str) -> list[AccountSettings]:
    return list(
        db.scalars(
            select(AccountSettings)
            .join(Mt5Connection, Mt5Connection.id == AccountSettings.connection_id)
            .where(Mt5Connection.user_id == user_id)
        )
    )


def list_access_log(db: Session, *, target_user_id: str, limit: int = 50) -> list[dict]:
    """Support access events about one user, newest first (ADR 0008 §6)."""
    rows = db.execute(
        select(AuditLog, User.username)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(
            AuditLog.target_user_id == target_user_id,
            AuditLog.action.like("support.%"),
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
    ).all()
    return [
        {"log": log, "actor_username": actor_username} for log, actor_username in rows
    ]


def iso(value: Optional[datetime]) -> Optional[str]:
    normalised = as_utc(value)
    return normalised.isoformat() if normalised is not None else None

"""Row-to-schema projections for the admin routers.

Kept out of the routers so the privacy boundary is easy to audit in one place:
these functions are the only way an admin response gains a field, and none of
them reads ``Mt5Connection.token_hash``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from app.domain.time import as_utc
from app.infrastructure.db.repositories.admin_repository import iso
from app.models.admin import (
    AccessLogItem,
    AdminAuditItem,
    AdminConnectionItem,
    AdminUserItem,
    SupportSessionItem,
)


def _remaining_seconds(expires_at: Optional[datetime]) -> int:
    normalised = as_utc(expires_at)
    if normalised is None:
        return 0
    return max(0, int((normalised - datetime.now(timezone.utc)).total_seconds()))


def user_item(row: dict) -> AdminUserItem:
    user = row["user"]
    return AdminUserItem(
        id=user.id,
        username=user.username,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        created_at=iso(user.created_at),
        last_seen_at=iso(row["last_seen_at"]),
        plan_code=row["plan_code"],
        max_connections=row["max_connections"],
        connection_count=row["connection_count"],
        active_connection_count=row["active_connection_count"],
        trade_count=row["trade_count"],
        last_trade_at=iso(row["last_trade_at"]),
    )


def connection_item(row: dict) -> AdminConnectionItem:
    connection = row["connection"]
    return AdminConnectionItem(
        id=connection.id,
        user_id=connection.user_id,
        username=row["username"],
        label=connection.label,
        token_prefix=connection.token_prefix,
        status=connection.status,
        account_number=connection.account_number,
        broker_server=connection.broker_server,
        account_currency=connection.account_currency,
        last_seen_at=iso(connection.last_seen_at),
        created_at=iso(connection.created_at),
        revoked_at=iso(connection.revoked_at),
        trade_count=row["trade_count"],
    )


def audit_item(row: dict) -> AdminAuditItem:
    log = row["log"]
    return AdminAuditItem(
        id=log.id,
        user_id=log.user_id,
        actor_username=row["actor_username"],
        target_user_id=log.target_user_id,
        target_username=row["target_username"],
        connection_id=log.connection_id,
        action=log.action,
        detail=log.detail,
        ip_address=log.ip_address,
        created_at=iso(log.created_at),
    )


def support_item(row: dict) -> SupportSessionItem:
    session = row["session"]
    revoked = session.revoked_at is not None
    remaining = 0 if revoked else _remaining_seconds(session.expires_at)
    return SupportSessionItem(
        id=session.id,
        admin_id=session.admin_id,
        admin_username=row["admin_username"],
        target_user_id=session.target_user_id,
        target_username=row["target_username"],
        reason=session.reason,
        granted_at=iso(session.granted_at),
        expires_at=iso(session.expires_at),
        revoked_at=iso(session.revoked_at),
        active=remaining > 0,
        seconds_remaining=remaining,
    )


def access_log_item(row: dict) -> AccessLogItem:
    log = row["log"]
    return AccessLogItem(
        id=log.id,
        action=log.action,
        actor_username=row["actor_username"],
        detail=log.detail,
        created_at=iso(log.created_at),
    )

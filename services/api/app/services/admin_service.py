"""Admin writes, each in the same transaction as its audit row.

ADR 0008 §4 is absolute: no admin mutation ships without an ``audit_logs``
entry. Keeping the mutation and the audit insert inside one ``session_scope``
means a failed write leaves neither behind, and a code path that forgets the
audit cannot commit silently — the tests assert exactly one row per mutation.

Support-mode reads also write an audit row, with ``target_user_id`` set, so the
affected user can see who opened their data (ADR 0008 §6).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.core import live_state
from app.core.config import settings
from app.db.base import session_scope
from app.db.models import (
    AuditLog,
    Entitlement,
    Mt5Connection,
    Plan,
    SupportSession,
    User,
)
from app.domain.time import as_utc
from app.infrastructure.db.repositories import admin_repository
from app.models.admin import AdminCreateUserRequest, AdminExtendExpiryRequest
from app.services.user_service import user_service

DETAIL_LIMIT = 512


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _audit(
    db: Session,
    *,
    actor_id: Optional[str],
    action: str,
    ip_address: Optional[str] = None,
    target_user_id: Optional[str] = None,
    connection_id: Optional[str] = None,
    detail: Optional[str] = None,
) -> None:
    db.add(
        AuditLog(
            user_id=actor_id,
            target_user_id=target_user_id,
            connection_id=connection_id,
            action=action[:64],
            detail=(detail or None) and detail[:DETAIL_LIMIT],
            ip_address=ip_address,
        )
    )


def _is_active(session: SupportSession) -> bool:
    if session.revoked_at is not None:
        return False
    expires_at = as_utc(session.expires_at)
    return expires_at is not None and expires_at > _now()


def _resolve_expiry(
    duration_days: Optional[int],
    exact_expires_at: Optional[datetime],
    set_lifetime: bool,
    current_expires_at: Optional[datetime] = None,
    now: Optional[datetime] = None,
) -> Optional[datetime]:
    """Return computed expires_at or raise ValueError.

    Accepts optional 'now' for deterministic testing.
    """
    if set_lifetime:
        return None
    now_utc = as_utc(now) or datetime.now(timezone.utc)
    if exact_expires_at is not None:
        target = as_utc(exact_expires_at)
        if target <= now_utc:
            raise ValueError("exact_expires_at must be in the future")
        return target
    if duration_days is not None and duration_days > 0:
        base = (
            current_expires_at
            if (current_expires_at and as_utc(current_expires_at) > now_utc)
            else now_utc
        )
        return as_utc(base) + timedelta(days=duration_days)
    raise ValueError("Provide duration_days, exact_expires_at, or set_lifetime")


class AdminService:
    # ------------------------------------------------------------------ users
    def create_user(
        self,
        db: Session,
        *,
        actor: User,
        req: AdminCreateUserRequest,
        ip_address: Optional[str],
    ) -> User:
        expires_at = _resolve_expiry(
            req.duration_days, req.exact_expires_at, req.set_lifetime
        )
        with session_scope(db):
            user = user_service.prepare_user(
                db,
                username=req.username,
                plain_password=req.password,
                role=req.role,
                email=req.email,
                plan_code=req.plan_code,
                expires_at=expires_at,
            )
            exp_str = expires_at.isoformat() if expires_at else "lifetime"
            _audit(
                db,
                actor_id=actor.id,
                target_user_id=user.id,
                action="admin.user.created",
                ip_address=ip_address,
                detail=f"plan={req.plan_code}, expires_at={exp_str}",
            )
        db.refresh(user)
        return user

    def extend_user_expiry(
        self,
        db: Session,
        *,
        actor: User,
        target: User,
        req: AdminExtendExpiryRequest,
        ip_address: Optional[str],
        now: Optional[datetime] = None,
    ) -> User:
        new_expires_at = _resolve_expiry(
            req.duration_days,
            req.exact_expires_at,
            req.set_lifetime,
            current_expires_at=target.expires_at,
            now=now,
        )
        previous = target.expires_at.isoformat() if target.expires_at else "lifetime"
        new_str = new_expires_at.isoformat() if new_expires_at else "lifetime"

        with session_scope(db):
            target.expires_at = new_expires_at
            _audit(
                db,
                actor_id=actor.id,
                target_user_id=target.id,
                action="admin.user.expiry_updated",
                ip_address=ip_address,
                detail=f"{previous} -> {new_str}",
            )
        db.refresh(target)
        return target
    def update_entitlement(
        self,
        db: Session,
        *,
        actor: User,
        target: User,
        plan_code: str,
        max_connections: Optional[int],
        ip_address: Optional[str],
    ) -> Entitlement:
        plan = db.get(Plan, plan_code)
        if plan is None:
            raise ValueError(f"Unknown plan code '{plan_code}'")

        entitlement = db.get(Entitlement, target.id)
        new_limit = (
            max_connections if max_connections is not None else plan.max_connections
        )

        with session_scope(db):
            if entitlement is None:
                entitlement = Entitlement(
                    user_id=target.id,
                    plan_code=plan.code,
                    max_connections=new_limit,
                )
                db.add(entitlement)
                previous = "none"
            else:
                previous = f"{entitlement.plan_code}/{entitlement.max_connections}"
                entitlement.plan_code = plan.code
                entitlement.max_connections = new_limit

            _audit(
                db,
                actor_id=actor.id,
                target_user_id=target.id,
                action="admin.entitlement.updated",
                ip_address=ip_address,
                detail=f"{previous} -> {plan.code}/{new_limit}",
            )
        db.refresh(entitlement)
        return entitlement

    def set_user_active(
        self,
        db: Session,
        *,
        actor: User,
        target: User,
        active: bool,
        ip_address: Optional[str],
    ) -> User:
        if target.id == actor.id and not active:
            raise ValueError("You cannot deactivate your own account")

        with session_scope(db):
            target.is_active = active
            if not active:
                # Revoke every live session immediately; re-activation must not
                # revive JWTs issued before the deactivation.
                target.token_version = int(target.token_version or 1) + 1
            _audit(
                db,
                actor_id=actor.id,
                target_user_id=target.id,
                action="admin.user.activated" if active else "admin.user.deactivated",
                ip_address=ip_address,
                detail=f"role={target.role}",
            )
        db.refresh(target)
        return target

    def revoke_connection(
        self,
        db: Session,
        *,
        actor: User,
        connection: Mt5Connection,
        ip_address: Optional[str],
    ) -> Mt5Connection:
        if connection.revoked_at is not None:
            raise ValueError("Connection is already revoked")

        with session_scope(db):
            connection.revoked_at = _now()
            connection.status = "revoked"
            _audit(
                db,
                actor_id=actor.id,
                target_user_id=connection.user_id,
                connection_id=connection.id,
                action="admin.connection.revoked",
                ip_address=ip_address,
            )
        live_state.clear_live_payload(connection.id)
        db.refresh(connection)
        return connection

    # --------------------------------------------------------------- support
    def grant_support_session(
        self,
        db: Session,
        *,
        actor: User,
        target: User,
        reason: str,
        ip_address: Optional[str],
    ) -> SupportSession:
        cleaned = (reason or "").strip()
        if len(cleaned) < 3:
            raise ValueError("A reason of at least 3 characters is required")

        existing = admin_repository.find_active_support_session(
            db, admin_id=actor.id, target_user_id=target.id
        )
        if existing is not None:
            raise ValueError("An active support session for this user already exists")

        now = _now()
        session = SupportSession(
            admin_id=actor.id,
            target_user_id=target.id,
            reason=cleaned[:DETAIL_LIMIT],
            granted_at=now,
            expires_at=now + timedelta(minutes=settings.SUPPORT_SESSION_MINUTES),
        )
        with session_scope(db):
            db.add(session)
            db.flush()
            _audit(
                db,
                actor_id=actor.id,
                target_user_id=target.id,
                action="support.granted",
                ip_address=ip_address,
                detail=f"session={session.id}; reason={cleaned}",
            )
        db.refresh(session)
        return session

    def revoke_support_session(
        self,
        db: Session,
        *,
        actor: User,
        session: SupportSession,
        ip_address: Optional[str],
    ) -> SupportSession:
        if session.revoked_at is not None:
            raise ValueError("Support session is already revoked")
        if session.admin_id != actor.id and actor.role != "admin":
            raise PermissionError("Only the granting admin or an admin may revoke")

        with session_scope(db):
            session.revoked_at = _now()
            _audit(
                db,
                actor_id=actor.id,
                target_user_id=session.target_user_id,
                action="support.revoked",
                ip_address=ip_address,
                detail=f"session={session.id}",
            )
        db.refresh(session)
        return session

    def require_active_support_session(
        self, db: Session, *, actor: User, target: User
    ) -> SupportSession:
        session = admin_repository.find_active_support_session(
            db, admin_id=actor.id, target_user_id=target.id
        )
        if session is None or not _is_active(session):
            raise PermissionError(
                "An active, non-expired support session is required to view user detail"
            )
        return session

    def record_detail_access(
        self,
        db: Session,
        *,
        actor: User,
        target: User,
        session: SupportSession,
        ip_address: Optional[str],
    ) -> None:
        with session_scope(db):
            _audit(
                db,
                actor_id=actor.id,
                target_user_id=target.id,
                action="support.detail_viewed",
                ip_address=ip_address,
                detail=f"session={session.id}",
            )


admin_service = AdminService()

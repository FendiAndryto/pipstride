"""Support mode: time-boxed, reason-required elevation (ADR 0008 §6/§8d).

Granting and revoking are mirrored to ``audit_logs`` with ``target_user_id`` so
the affected user's access log (``/api/v1/access-log``) shows them. The only
path to trade contents or account settings is ``GET /users/{id}/detail`` while
such a session is active; there is no "admin sees everything" fallback.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.v1.admin.projections import support_item
from app.core.config import settings
from app.core.deps import require_role
from app.core.rate_limit import get_client_ip
from app.db.base import get_db
from app.db.models import User
from app.infrastructure.db.repositories import admin_repository
from app.models.admin import (
    ElevatedAccountSettingsItem,
    ElevatedTradeItem,
    ElevatedUserDetailResponse,
    SupportSessionCreateRequest,
    SupportSessionItem,
    SupportSessionListResponse,
)
from app.services.admin_service import admin_service

router = APIRouter(
    prefix="/support",
    tags=["Admin · Support mode"],
    dependencies=[Depends(require_role("admin", "support"))],
)


def _require_support_mode() -> None:
    if not settings.SUPPORT_MODE_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Support mode is disabled. Enable SUPPORT_MODE_ENABLED after the access log ships.",
        )


@router.get(
    "/sessions",
    response_model=SupportSessionListResponse,
    summary="List support sessions (own by default, all for admins)",
)
def list_sessions(
    mine: bool = Query(True),
    active_only: bool = Query(False),
    actor: User = Depends(require_role("admin", "support")),
    db: Session = Depends(get_db),
):
    admin_id = actor.id if (mine or actor.role != "admin") else None
    rows = admin_repository.list_support_sessions(
        db, admin_id=admin_id, active_only=active_only
    )
    return SupportSessionListResponse(items=[support_item(row) for row in rows])


@router.post(
    "/sessions",
    response_model=SupportSessionItem,
    status_code=status.HTTP_201_CREATED,
    summary="Grant a 30-minute support session with a mandatory reason",
)
def grant_session(
    req: SupportSessionCreateRequest,
    request: Request,
    actor: User = Depends(require_role("admin", "support")),
    db: Session = Depends(get_db),
):
    _require_support_mode()
    target = db.get(User, req.target_user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    if target.id == actor.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot open a support session on your own account",
        )

    try:
        session = admin_service.grant_support_session(
            db,
            actor=actor,
            target=target,
            reason=req.reason,
            ip_address=get_client_ip(request),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    row = admin_repository.get_support_session(db, session.id)
    return support_item(row)


@router.post(
    "/sessions/{session_id}/revoke",
    response_model=SupportSessionItem,
    summary="Revoke a support session early (audited)",
)
def revoke_session(
    session_id: str,
    request: Request,
    actor: User = Depends(require_role("admin", "support")),
    db: Session = Depends(get_db),
):
    _require_support_mode()
    row = admin_repository.get_support_session(db, session_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Support session not found"
        )

    try:
        admin_service.revoke_support_session(
            db,
            actor=actor,
            session=row["session"],
            ip_address=get_client_ip(request),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    return support_item(admin_repository.get_support_session(db, session_id))


@router.get(
    "/users/{user_id}/detail",
    response_model=ElevatedUserDetailResponse,
    summary="Trade contents and settings, only during an active support session",
)
def elevated_user_detail(
    user_id: str,
    request: Request,
    actor: User = Depends(require_role("admin", "support")),
    db: Session = Depends(get_db),
):
    _require_support_mode()
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    try:
        session = admin_service.require_active_support_session(
            db, actor=actor, target=target
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    admin_service.record_detail_access(
        db,
        actor=actor,
        target=target,
        session=session,
        ip_address=get_client_ip(request),
    )

    trades = admin_repository.list_trades_for_user(db, target.id)
    account_settings = admin_repository.list_account_settings_for_user(db, target.id)
    session_row = admin_repository.get_support_session(db, session.id)

    return ElevatedUserDetailResponse(
        user_id=target.id,
        username=target.username,
        support_session=support_item(session_row),
        trades=[
            ElevatedTradeItem(
                id=trade.id,
                ticket=trade.ticket,
                symbol=trade.symbol,
                direction=trade.direction,
                volume=trade.volume,
                profit=trade.profit,
                opened_at=admin_repository.iso(trade.opened_at),
                closed_at=admin_repository.iso(trade.closed_at),
            )
            for trade in trades
        ],
        account_settings=[
            ElevatedAccountSettingsItem(
                connection_id=setting.connection_id,
                custom_initial_deposit=setting.custom_initial_deposit,
                updated_at=admin_repository.iso(setting.updated_at),
            )
            for setting in account_settings
        ],
    )

"""Read-only user endpoints plus the audited admin mutations (ADR 0008 §8a/§8c).

The router guard allows ``admin`` and ``support`` for reads. Mutations declare a
second, narrower guard (``admin`` only) on each endpoint, so support staff can
inspect but cannot change entitlements or account state.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.v1.admin.projections import connection_item, user_item
from app.core.deps import require_role
from app.core.rate_limit import get_client_ip
from app.db.base import get_db
from app.db.models import User
from app.infrastructure.db.repositories import admin_repository
from app.models.admin import (
    AdminUserDetailResponse,
    AdminUserItem,
    AdminUserListResponse,
    EntitlementUpdateRequest,
)
from app.services.admin_service import admin_service

router = APIRouter(
    prefix="/users",
    tags=["Admin · Users"],
    dependencies=[Depends(require_role("admin", "support"))],
)


@router.get(
    "", response_model=AdminUserListResponse, summary="List users (metadata only)"
)
def list_users(
    search: Optional[str] = Query(None, max_length=128),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows, total = admin_repository.list_users(
        db, search=search, limit=limit, offset=offset
    )
    return AdminUserListResponse(
        items=[user_item(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{user_id}",
    response_model=AdminUserDetailResponse,
    summary="User metadata and connection status (no trade or settings contents)",
)
def get_user(user_id: str, db: Session = Depends(get_db)):
    row = admin_repository.get_user(db, user_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    connections, _ = admin_repository.list_connections(db, user_id=user_id, limit=200)
    item = user_item(row)
    return AdminUserDetailResponse(
        **item.model_dump(),
        connections=[connection_item(connection) for connection in connections],
    )


def _target_user_or_404(db: Session, user_id: str) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return target


@router.patch(
    "/{user_id}/entitlement",
    response_model=AdminUserItem,
    summary="Change a user's plan and connection quota (audited)",
    dependencies=[Depends(require_role("admin"))],
)
def update_entitlement(
    user_id: str,
    req: EntitlementUpdateRequest,
    request: Request,
    actor: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    target = _target_user_or_404(db, user_id)
    try:
        admin_service.update_entitlement(
            db,
            actor=actor,
            target=target,
            plan_code=req.plan_code,
            max_connections=req.max_connections,
            ip_address=get_client_ip(request),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    row = admin_repository.get_user(db, target.id)
    return user_item(row)


@router.post(
    "/{user_id}/deactivate",
    response_model=AdminUserItem,
    summary="Deactivate a user and revoke their sessions (audited)",
    dependencies=[Depends(require_role("admin"))],
)
def deactivate_user(
    user_id: str,
    request: Request,
    actor: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    target = _target_user_or_404(db, user_id)
    try:
        admin_service.set_user_active(
            db,
            actor=actor,
            target=target,
            active=False,
            ip_address=get_client_ip(request),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    return user_item(admin_repository.get_user(db, target.id))


@router.post(
    "/{user_id}/activate",
    response_model=AdminUserItem,
    summary="Re-activate a user (audited)",
    dependencies=[Depends(require_role("admin"))],
)
def activate_user(
    user_id: str,
    request: Request,
    actor: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    target = _target_user_or_404(db, user_id)
    admin_service.set_user_active(
        db,
        actor=actor,
        target=target,
        active=True,
        ip_address=get_client_ip(request),
    )
    return user_item(admin_repository.get_user(db, target.id))

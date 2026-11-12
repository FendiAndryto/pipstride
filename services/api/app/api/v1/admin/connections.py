"""Connection metadata and the audited admin revoke action (ADR 0008 §6).

No endpoint here returns ``token_hash`` or a raw token. Revocation is the only
mutation: admins can stop a leaked credential, never mint a new one.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.v1.admin.projections import connection_item
from app.core.deps import require_role
from app.core.rate_limit import get_client_ip
from app.db.base import get_db
from app.db.models import Mt5Connection, User
from app.infrastructure.db.repositories import admin_repository
from app.models.admin import AdminConnectionItem, AdminConnectionListResponse
from app.services.admin_service import admin_service

router = APIRouter(
    prefix="/connections",
    tags=["Admin · Connections"],
    dependencies=[Depends(require_role("admin", "support"))],
)


@router.get(
    "",
    response_model=AdminConnectionListResponse,
    summary="List MT5 connections across users (metadata only)",
)
def list_connections(
    status_filter: Optional[str] = Query(
        None, alias="status", pattern="^(active|revoked|pending|connected)$"
    ),
    user_id: Optional[str] = Query(None, max_length=36),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows, total = admin_repository.list_connections(
        db, status=status_filter, user_id=user_id, limit=limit, offset=offset
    )
    return AdminConnectionListResponse(
        items=[connection_item(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/{connection_id}/revoke",
    response_model=AdminConnectionItem,
    summary="Revoke a connection (audited; token is never returned)",
    dependencies=[Depends(require_role("admin"))],
)
def revoke_connection(
    connection_id: str,
    request: Request,
    actor: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    connection = db.get(Mt5Connection, connection_id)
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found"
        )

    try:
        admin_service.revoke_connection(
            db,
            actor=actor,
            connection=connection,
            ip_address=get_client_ip(request),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    row = admin_repository.get_connection(db, connection_id)
    return connection_item(row)

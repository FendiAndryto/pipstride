"""Audit trail reader. Read-only by design: audit rows are never edited."""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.v1.admin.projections import audit_item
from app.core.deps import require_role
from app.db.base import get_db
from app.infrastructure.db.repositories import admin_repository
from app.models.admin import AdminAuditListResponse

router = APIRouter(
    prefix="/audit",
    tags=["Admin · Audit"],
    dependencies=[Depends(require_role("admin", "support"))],
)


@router.get(
    "",
    response_model=AdminAuditListResponse,
    summary="Recent audit events (the same rows the affected user can see)",
)
def list_audit(
    user_id: Optional[str] = Query(None, max_length=36),
    target_user_id: Optional[str] = Query(None, max_length=36),
    action: Optional[str] = Query(None, max_length=64),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows, total = admin_repository.list_audit(
        db,
        user_id=user_id,
        target_user_id=target_user_id,
        action=action,
        limit=limit,
        offset=offset,
    )
    return AdminAuditListResponse(
        items=[audit_item(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )

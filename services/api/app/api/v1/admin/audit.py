"""Audit trail reader. Read-only by design: audit rows are never edited."""

from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime, BeforeValidator
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


def _iso_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed
    except (ValueError, OverflowError) as exc:
        raise ValueError("Expected an ISO datetime with a timezone") from exc


AuditDateTime = Annotated[AwareDatetime, BeforeValidator(_iso_datetime)]


@router.get(
    "",
    response_model=AdminAuditListResponse,
    summary="Recent audit events (the same rows the affected user can see)",
)
def list_audit(
    user_id: Optional[str] = Query(None, max_length=36),
    target_user_id: Optional[str] = Query(None, max_length=36),
    action: Optional[str] = Query(None, max_length=64),
    start: Optional[AuditDateTime] = Query(None),
    end: Optional[AuditDateTime] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    if start is not None and end is not None and start > end:
        raise HTTPException(status_code=422, detail="start must be on or before end")

    rows, total = admin_repository.list_audit(
        db,
        user_id=user_id,
        target_user_id=target_user_id,
        action=action,
        start=start,
        end=end,
        limit=limit,
        offset=offset,
    )
    return AdminAuditListResponse(
        items=[audit_item(row) for row in rows],
        actions=admin_repository.list_audit_actions(db),
        total=total,
        limit=limit,
        offset=offset,
    )

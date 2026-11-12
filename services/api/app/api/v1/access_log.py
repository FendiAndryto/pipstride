"""User-visible access log (ADR 0008 §6).

A trader can see every support-mode access to their own data. This endpoint is
the hard prerequisite for enabling support mode: it is shipped with the feature,
not after it.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.infrastructure.db.repositories import admin_repository
from app.models.admin import AccessLogItem, AccessLogListResponse

router = APIRouter(prefix="/access-log", tags=["Access Log"])


@router.get(
    "",
    response_model=AccessLogListResponse,
    summary="Who accessed your data and when (support-mode events only)",
)
def list_access_log(
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = admin_repository.list_access_log(db, target_user_id=user.id, limit=limit)
    return AccessLogListResponse(
        items=[
            AccessLogItem(
                id=row["log"].id,
                action=row["log"].action,
                actor_username=row["actor_username"],
                detail=row["log"].detail,
                created_at=admin_repository.iso(row["log"].created_at),
            )
            for row in rows
        ]
    )

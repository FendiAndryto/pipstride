"""Aggregate counters for the admin overview."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import require_role
from app.db.base import get_db
from app.infrastructure.db.repositories import admin_repository
from app.models.admin import AdminMetricsResponse

router = APIRouter(
    prefix="/metrics",
    tags=["Admin · Metrics"],
    dependencies=[Depends(require_role("admin", "support"))],
)


@router.get("", response_model=AdminMetricsResponse, summary="Platform counters")
def get_metrics(db: Session = Depends(get_db)):
    return AdminMetricsResponse(**admin_repository.metrics(db))

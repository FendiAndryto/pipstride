"""Admin router aggregate (ADR 0008 §8a–d).

Every module in this package attaches ``require_role(...)`` at router level.
``tests/test_admin_guard.py`` parses these modules and fails CI when a bare
``APIRouter`` appears, so the convention is enforced rather than documented.
"""

from fastapi import APIRouter, Depends

from app.api.v1.admin import audit, connections, metrics, support, users
from app.core.deps import require_role

router = APIRouter(
    prefix="/admin",
    tags=["Admin"],
    dependencies=[Depends(require_role("admin", "support"))],
)

router.include_router(users.router)
router.include_router(connections.router)
router.include_router(audit.router)
router.include_router(metrics.router)
router.include_router(support.router)

from fastapi import APIRouter, Depends, status
from app.models.risk import KillSwitchStatusResponse
from app.services.bridge_service import bridge_service
from app.core.deps import get_current_user

router = APIRouter(prefix="/risk", tags=["Risk Watchdog"])


@router.get(
    "/status",
    response_model=KillSwitchStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve current Risk Watchdog status and parameters for current user"
)
async def get_risk_status(current_user: str = Depends(get_current_user)):
    return bridge_service.get_kill_switch_status(current_user)

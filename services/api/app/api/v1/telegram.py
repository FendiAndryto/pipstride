from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.deps import require_admin
from app.core.rate_limit import consume, get_client_ip
from app.services.telegram_service import telegram_service

router = APIRouter(prefix="/telegram", tags=["Telegram Notifications & Remote Alerts"])


class TelegramTestAlertRequest(BaseModel):
    message: Optional[str] = Field(None, max_length=100, description="Optional brief test note (max 100 chars)")


class TelegramToggleRequest(BaseModel):
    enabled: bool = Field(..., description="Enable or disable Telegram push notifications")


@router.get(
    "/status",
    status_code=status.HTTP_200_OK,
    summary="Get Telegram notification configuration and connectivity status"
)
async def get_telegram_status(current_user=Depends(require_admin)):
    return telegram_service.get_status()


@router.post(
    "/test-alert",
    status_code=status.HTTP_200_OK,
    summary="Trigger a test notification to verify Telegram Bot integration"
)
async def send_test_alert(
    request: Request,
    response: Response,
    payload: TelegramTestAlertRequest = TelegramTestAlertRequest(),
    current_user=Depends(require_admin)
):
    # Enforce strict rate limit on alert dispatch (max 2 per 10 minutes per user & IP)
    client_ip = get_client_ip(request)
    limited, retry_after = consume(f"tg_test:{current_user.id}", limit=2, window_seconds=600)
    if not limited:
        limited, retry_after = consume(f"tg_test_ip:{client_ip}", limit=5, window_seconds=600)

    if limited:
        response.headers["Retry-After"] = str(retry_after)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Terlalu banyak permintaan uji coba Telegram. Coba lagi dalam {retry_after} detik.",
            headers={"Retry-After": str(retry_after)},
        )

    # Strictly templated message format to eliminate spam / phishing misuse
    clean_note = ""
    if payload.message:
        clean_note = payload.message.strip().replace("\r", " ").replace("\n", " ")[:100]

    msg = (
        "Pipstride — TEST NOTIFICATION\n\n"
        "Your Telegram watchdog alert channel is operating normally!\n"
        f"Triggered by admin: {current_user.username}\n"
        "Status: operational"
    )
    if clean_note:
        msg += f"\nNote: {clean_note}"

    success = await telegram_service.send_message(msg)
    return {
        "status": "sent" if success else "failed_or_disabled",
        "delivered": success,
        "is_configured": telegram_service.is_configured,
        "is_enabled": telegram_service.is_enabled,
        "message": "Test notification dispatched to Telegram" if success else "Notification skipped (not configured or disabled)"
    }


@router.post(
    "/toggle",
    status_code=status.HTTP_200_OK,
    summary="Toggle Telegram notifications on or off (Admin only)"
)
async def toggle_telegram(
    payload: TelegramToggleRequest,
    current_user=Depends(require_admin)
):
    settings.TELEGRAM_NOTIFICATIONS_ENABLED = payload.enabled
    return {
        "status": "success",
        "notifications_enabled": settings.TELEGRAM_NOTIFICATIONS_ENABLED,
        "updated_by": current_user.username
    }

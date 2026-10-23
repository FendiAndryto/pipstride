from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from typing import Optional
from app.services.telegram_service import telegram_service
from app.core.deps import get_current_user
from app.core.config import settings

router = APIRouter(prefix="/telegram", tags=["Telegram Notifications & Remote Alerts"])


class TelegramTestAlertRequest(BaseModel):
    message: Optional[str] = Field(None, description="Optional custom test message")


class TelegramToggleRequest(BaseModel):
    enabled: bool = Field(..., description="Enable or disable Telegram push notifications")


@router.get(
    "/status",
    status_code=status.HTTP_200_OK,
    summary="Get Telegram notification configuration and connectivity status"
)
async def get_telegram_status():
    return telegram_service.get_status()


@router.post(
    "/test-alert",
    status_code=status.HTTP_200_OK,
    summary="Trigger a test notification to verify Telegram Bot integration"
)
async def send_test_alert(
    payload: TelegramTestAlertRequest = TelegramTestAlertRequest(),
    current_user: str = Depends(get_current_user)
):
    msg = payload.message or (
        "🚀 <b>ROBOT TRADING MT5 — TEST NOTIFICATION</b>\n\n"
        "Your Telegram alert bridge is operating normally!\n"
        f"<b>Triggered by:</b> <code>{current_user}</code>\n"
        "<b>Status:</b> 🟢 Operational"
    )

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
    summary="Toggle Telegram notifications on or off"
)
async def toggle_telegram(
    payload: TelegramToggleRequest,
    current_user: str = Depends(get_current_user)
):
    settings.TELEGRAM_NOTIFICATIONS_ENABLED = payload.enabled
    return {
        "status": "success",
        "notifications_enabled": settings.TELEGRAM_NOTIFICATIONS_ENABLED,
        "updated_by": current_user
    }

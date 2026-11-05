"""Telegram notification request schemas."""

from typing import Optional

from pydantic import BaseModel, Field


class TelegramTestAlertRequest(BaseModel):
    message: Optional[str] = Field(None, max_length=100, description="Optional brief test note (max 100 chars)")


class TelegramToggleRequest(BaseModel):
    enabled: bool = Field(..., description="Enable or disable Telegram push notifications")

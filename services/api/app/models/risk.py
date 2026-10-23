from typing import Optional

from pydantic import BaseModel, Field


class RiskWatchdogStatusResponse(BaseModel):
    """Passive risk watchdog state. Never triggers order liquidation."""

    is_alert_active: bool = False
    alert_reason: Optional[str] = None
    alert_time: Optional[int] = None
    daily_drawdown_percent: float = 0.0
    max_daily_drawdown_percent: float = 3.0
    margin_level: float = 0.0
    max_spread_points: int = Field(35, description="Spread ceiling used by the watchdog")
    default_risk_percent: float = 1.0
    max_risk_percent: float = 10.0
    min_lot: float = 0.01
    max_lot: float = 100.0

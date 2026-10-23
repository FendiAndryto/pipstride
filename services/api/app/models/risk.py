from typing import Optional
from pydantic import BaseModel, Field


class LotCalculationRequest(BaseModel):
    symbol: str = Field(..., min_length=1, description="Trading instrument symbol (e.g. EURUSD, USDJPY, XAUUSD)")
    stop_loss_pips: float = Field(..., gt=0, description="Stop loss distance in pips")
    risk_percent: Optional[float] = Field(None, gt=0, le=100, description="Risk percentage of equity (defaults to configured setting)")
    equity: Optional[float] = Field(None, gt=0, description="Optional custom account equity; defaults to live MT5 equity")
    account_currency: Optional[str] = Field("USD", description="Account base currency")
    market_price: Optional[float] = Field(None, gt=0, description="Optional current market price for pip value conversion")


class LotCalculationResponse(BaseModel):
    symbol: str
    equity: float
    risk_percent: float
    risk_amount: float
    stop_loss_pips: float
    pip_value_per_lot: float
    calculated_lot: float
    raw_lot: float
    min_lot: float
    max_lot: float
    currency: str


class KillSwitchTriggerRequest(BaseModel):
    reason: Optional[str] = Field(
        "Emergency Kill Switch triggered via Web Control",
        description="Reason for triggering the emergency kill switch"
    )


class KillSwitchStatusResponse(BaseModel):
    is_kill_switch_active: bool
    kill_switch_reason: Optional[str] = None
    kill_switch_time: Optional[int] = None
    kill_switch_user: Optional[str] = None
    default_risk_percent: float
    max_risk_percent: float
    max_daily_drawdown_percent: float
    min_lot: float
    max_lot: float

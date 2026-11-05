from typing import Optional

from pydantic import BaseModel, Field


class RiskWatchdogStatusResponse(BaseModel):
    """Passive risk watchdog state. Never triggers order liquidation.

    Two drawdowns are reported (spec 003):

    * ``daily_*`` — measured from the broker-day anchor equity, with
      ``daily_max_drawdown_percent`` holding the worst reading of the day.
    * ``overall_*`` / ``max_drawdown_percent`` — peak-to-trough over the whole
      reconstructed history.

    Every field added by spec 003 has a default so an older web bundle keeps
    deserialising this payload unchanged.
    """

    is_alert_active: bool = False
    alert_reason: Optional[str] = None
    alert_time: Optional[int] = None

    # False when no equity basis could be established (no snapshot, no deposit,
    # no live metrics). The numeric fields are still present for old clients, but
    # they are zeros — a UI that can tell the difference must show a dash rather
    # than a reassuring 0.00% (spec 003, ticket 09-02).
    is_data_available: bool = True

    # --- daily (broker-day anchored) -------------------------------------
    daily_drawdown_percent: float = 0.0
    daily_max_drawdown_percent: float = 0.0
    daily_realized_pnl: Optional[float] = None
    daily_starting_balance: Optional[float] = None
    daily_starting_equity: Optional[float] = None
    daily_anchor_at: Optional[int] = None
    daily_anchor_source: Optional[str] = None
    max_daily_drawdown_percent: float = 3.0

    # --- overall (peak-to-trough) ----------------------------------------
    overall_drawdown_percent: float = 0.0
    max_drawdown_percent: float = 0.0
    peak_equity: Optional[float] = None
    peak_equity_at: Optional[int] = None
    max_overall_drawdown_percent: float = 10.0
    is_overall_alert_active: bool = False

    # --- account state ----------------------------------------------------
    margin_level: float = 0.0
    max_spread_points: int = Field(35, description="Spread ceiling used by the watchdog")
    default_risk_percent: float = 1.0
    max_risk_percent: float = 10.0
    min_lot: float = 0.01
    max_lot: float = 100.0

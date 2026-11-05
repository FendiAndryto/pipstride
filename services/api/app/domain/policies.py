"""Pure risk policies.

The policy decides *whether* a threshold is breached and *why* (a machine
reason code); formatting a user-facing message is the view's job.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

DRAWDOWN_ALERT_REASON = "daily_drawdown_breached"


@dataclass(frozen=True)
class DrawdownEvaluation:
    drawdown_pct: float
    is_alert_active: bool
    threshold_percent: float
    reason_code: Optional[str] = None


def evaluate_daily_drawdown(
    starting_balance: Optional[float],
    equity: Optional[float],
    threshold_percent: float,
) -> DrawdownEvaluation:
    """Compare current equity against the start-of-day balance.

    A missing or non-positive baseline cannot produce a drawdown, so it is
    reported as a clean zero rather than an alert.
    """
    if not starting_balance or starting_balance <= 0 or equity is None:
        return DrawdownEvaluation(0.0, False, threshold_percent)

    drawdown = max(0.0, ((starting_balance - equity) / starting_balance) * 100.0)
    active = drawdown >= threshold_percent
    return DrawdownEvaluation(
        drawdown_pct=round(drawdown, 2),
        is_alert_active=active,
        threshold_percent=threshold_percent,
        reason_code=DRAWDOWN_ALERT_REASON if active else None,
    )

"""Pure risk policies.

The policy decides *whether* a threshold is breached and *why* (a machine
reason code); formatting a user-facing message is the view's job.

Two drawdowns are evaluated, both **equity against equity**:

* daily — against the broker-day anchor (spec 003, ticket 09-01). Comparing a
  balance anchor with current equity made a floating loss at rollover look like
  a same-day drawdown, which is the bug this replaces.
* overall — peak-to-trough over the whole reconstructed history (ticket 09-02).

Both report the *worst* value seen so far, not only the current one: a daily
drawdown that recovers must keep its alert until the day rolls over, otherwise
the 3% breach disappears the moment price comes back.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

DRAWDOWN_ALERT_REASON = "daily_drawdown_breached"
OVERALL_DRAWDOWN_ALERT_REASON = "overall_drawdown_breached"


@dataclass(frozen=True)
class DrawdownEvaluation:
    """Drawdown result. ``drawdown_pct`` is the value alerts key off (the max)."""

    drawdown_pct: float
    is_alert_active: bool
    threshold_percent: float
    reason_code: Optional[str] = None
    current_pct: float = 0.0
    max_pct: float = 0.0


def _percent_from(anchor: Optional[float], value: Optional[float]) -> float:
    """How far ``value`` sits below ``anchor``, in percent; never negative.

    A missing or non-positive anchor cannot produce a drawdown, so it is
    reported as a clean zero rather than an alert.
    """
    if not anchor or anchor <= 0 or value is None:
        return 0.0
    return max(0.0, ((anchor - value) / anchor) * 100.0)


def evaluate_drawdown(
    anchor_equity: Optional[float],
    current_equity: Optional[float],
    lowest_equity: Optional[float],
    threshold_percent: float,
) -> DrawdownEvaluation:
    """Daily drawdown against the broker-day anchor equity.

    ``lowest_equity`` is the trough observed since the anchor (snapshot
    minimum). Alerts use the worse of the trough and the current reading so a
    breach inside the day is not erased by a later recovery.
    """
    current = _percent_from(anchor_equity, current_equity)

    trough = current_equity
    if lowest_equity is not None and (trough is None or lowest_equity < trough):
        trough = lowest_equity
    worst = max(current, _percent_from(anchor_equity, trough))

    active = worst >= threshold_percent
    return DrawdownEvaluation(
        drawdown_pct=round(worst, 2),
        is_alert_active=active,
        threshold_percent=threshold_percent,
        reason_code=DRAWDOWN_ALERT_REASON if active else None,
        current_pct=round(current, 2),
        max_pct=round(worst, 2),
    )


def evaluate_overall_drawdown(
    peak_equity: Optional[float],
    current_equity: Optional[float],
    lowest_equity: Optional[float],
    threshold_percent: float,
) -> DrawdownEvaluation:
    """Peak-to-trough drawdown over the whole account history.

    ``peak_equity`` is the highest equity ever reached, ``lowest_equity`` the
    lowest equity reached after that peak. ``current_equity`` fills in for a
    missing trough so a fresh account still reports its live distance from peak.
    """
    current = _percent_from(peak_equity, current_equity)

    trough = current_equity
    if lowest_equity is not None and (trough is None or lowest_equity < trough):
        trough = lowest_equity
    worst = max(current, _percent_from(peak_equity, trough))

    active = worst >= threshold_percent
    return DrawdownEvaluation(
        drawdown_pct=round(worst, 2),
        is_alert_active=active,
        threshold_percent=threshold_percent,
        reason_code=OVERALL_DRAWDOWN_ALERT_REASON if active else None,
        current_pct=round(current, 2),
        max_pct=round(worst, 2),
    )

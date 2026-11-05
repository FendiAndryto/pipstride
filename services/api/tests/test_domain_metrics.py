"""Pure domain rules: no database, no framework, no fixtures."""

from app.domain.metrics import profit_factor, win_rate
from app.domain.policies import DRAWDOWN_ALERT_REASON, evaluate_daily_drawdown


def test_profit_factor_is_none_when_gross_loss_is_zero():
    assert profit_factor(150.0, 0.0) is None
    assert profit_factor(0.0, 0.0) is None


def test_profit_factor_divides_by_absolute_loss():
    assert profit_factor(150.0, -30.0) == 5.0


def test_win_rate_of_an_empty_set_is_zero():
    assert win_rate(0, 0) == 0.0
    assert win_rate(2, 4) == 50.0


def test_drawdown_policy_flags_a_breach():
    result = evaluate_daily_drawdown(10_000.0, 9_650.0, 3.0)

    assert result.drawdown_pct == 3.5
    assert result.is_alert_active is True
    assert result.reason_code == DRAWDOWN_ALERT_REASON


def test_drawdown_policy_ignores_a_missing_baseline():
    result = evaluate_daily_drawdown(0.0, 9_650.0, 3.0)

    assert result.drawdown_pct == 0.0
    assert result.is_alert_active is False
    assert result.reason_code is None

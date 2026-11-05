"""Pure domain rules: no database, no framework, no fixtures."""

from datetime import datetime, timezone

from app.domain.metrics import profit_factor, win_rate
from app.domain.policies import (
    DRAWDOWN_ALERT_REASON,
    OVERALL_DRAWDOWN_ALERT_REASON,
    evaluate_drawdown,
    evaluate_overall_drawdown,
)
from app.domain.time import (
    broker_day_start_utc,
    broker_offset_from_bars,
    broker_utc_offset_seconds,
)


def test_profit_factor_is_none_when_gross_loss_is_zero():
    assert profit_factor(150.0, 0.0) is None
    assert profit_factor(0.0, 0.0) is None


def test_profit_factor_divides_by_absolute_loss():
    assert profit_factor(150.0, -30.0) == 5.0


def test_win_rate_of_an_empty_set_is_zero():
    assert win_rate(0, 0) == 0.0
    assert win_rate(2, 4) == 50.0


# --------------------------------------------------------------- daily drawdown
def test_daily_drawdown_flags_a_breach():
    result = evaluate_drawdown(10_000.0, 9_650.0, None, 3.0)

    assert result.current_pct == 3.5
    assert result.max_pct == 3.5
    assert result.drawdown_pct == 3.5
    assert result.is_alert_active is True
    assert result.reason_code == DRAWDOWN_ALERT_REASON


def test_daily_drawdown_ignores_a_missing_anchor():
    result = evaluate_drawdown(0.0, 9_650.0, None, 3.0)

    assert result.drawdown_pct == 0.0
    assert result.is_alert_active is False
    assert result.reason_code is None


def test_daily_drawdown_never_goes_negative_when_equity_is_above_anchor():
    """A profitable day is 0% drawdown, not a negative percentage."""
    result = evaluate_drawdown(10_000.0, 10_500.0, None, 3.0)

    assert result.current_pct == 0.0
    assert result.max_pct == 0.0
    assert result.is_alert_active is False


def test_daily_max_drawdown_holds_the_intraday_trough():
    """Recovering from a 3.5% dip must not erase the breach.

    Current equity is only 0.5% under the anchor, but the day's low was 3.5%
    under it, so the alert stays on until the day rolls over.
    """
    result = evaluate_drawdown(10_000.0, 9_950.0, 9_650.0, 3.0)

    assert result.current_pct == 0.5
    assert result.max_pct == 3.5
    assert result.drawdown_pct == 3.5
    assert result.is_alert_active is True


def test_daily_max_drawdown_uses_current_equity_when_it_is_the_lowest():
    """The live equity can be the trough when no snapshot is lower."""
    result = evaluate_drawdown(10_000.0, 9_600.0, 9_900.0, 3.0)

    assert result.max_pct == 4.0


# ------------------------------------------------------------- overall drawdown
def test_overall_drawdown_is_peak_to_trough():
    result = evaluate_overall_drawdown(12_000.0, 11_000.0, 10_800.0, 10.0)

    assert result.current_pct == 8.33
    assert result.max_pct == 10.0
    assert result.is_alert_active is True
    assert result.reason_code == OVERALL_DRAWDOWN_ALERT_REASON


def test_overall_drawdown_below_threshold_stays_quiet():
    result = evaluate_overall_drawdown(12_000.0, 11_800.0, 11_700.0, 10.0)

    assert result.is_alert_active is False
    assert result.reason_code is None


# ------------------------------------------------------------- broker day clock
def test_broker_offset_uses_the_payload_clock():
    now = datetime(2026, 1, 2, 1, 0, tzinfo=timezone.utc)
    # Broker clock reads 03:00 while UTC reads 01:00 -> UTC+2.
    assert broker_utc_offset_seconds(int(now.timestamp()) + 7200, now) == 7200


def test_broker_offset_rounds_to_the_nearest_quarter_hour():
    now = datetime(2026, 1, 2, 1, 0, tzinfo=timezone.utc)
    # 1h23m of drift snaps to 1h30m, not to a literal 4980s offset.
    assert broker_utc_offset_seconds(int(now.timestamp()) + 4980, now) == 5400


def test_broker_offset_is_clamped_for_a_broken_terminal_clock():
    now = datetime(2026, 1, 2, 1, 0, tzinfo=timezone.utc)
    assert broker_utc_offset_seconds(int(now.timestamp()) + 20 * 3600, now) == 14 * 3600
    assert broker_utc_offset_seconds(int(now.timestamp()) - 20 * 3600, now) == -14 * 3600


def test_broker_offset_falls_back_to_utc_without_a_timestamp():
    now = datetime(2026, 1, 2, 1, 0, tzinfo=timezone.utc)
    assert broker_utc_offset_seconds(None, now) == 0
    assert broker_utc_offset_seconds(0, now) == 0


def test_broker_day_start_is_broker_midnight_not_utc_midnight():
    # 01:00 UTC on Jan 2 is 03:00 broker (UTC+2), still the same broker day.
    now = datetime(2026, 1, 2, 1, 0, tzinfo=timezone.utc)
    boundary = broker_day_start_utc(now, 7200)

    assert boundary == datetime(2026, 1, 1, 22, 0, tzinfo=timezone.utc)
    # UTC midnight would have been 2 hours later, which is the bug being fixed.
    assert boundary != datetime(2026, 1, 2, 0, 0, tzinfo=timezone.utc)


def test_broker_day_start_handles_a_half_hour_offset():
    now = datetime(2026, 1, 2, 1, 0, tzinfo=timezone.utc)
    boundary = broker_day_start_utc(now, 19_800)  # UTC+5:30

    assert boundary == datetime(2026, 1, 1, 18, 30, tzinfo=timezone.utc)


def test_broker_offset_from_bars_reads_the_server_clock():
    now = datetime(2026, 1, 2, 1, 0, tzinfo=timezone.utc)
    # The newest M5 bar opened at 03:00 server time, i.e. UTC+2.
    candles = [{"time": int(now.timestamp()) + 7200 - 60}]

    assert broker_offset_from_bars(candles, now) == 7200


def test_broker_offset_from_bars_uses_the_newest_bar_and_accepts_models():
    now = datetime(2026, 1, 2, 1, 0, tzinfo=timezone.utc)
    older = int(now.timestamp()) - 3600
    newest = int(now.timestamp()) + 3600

    class Bar:
        def __init__(self, time):
            self.time = time

    # Dicts and model-shaped candles are both accepted; only the newest counts.
    candles = [{"time": older}, Bar(newest)]
    assert broker_offset_from_bars(candles, now) == 3600


def test_broker_offset_from_bars_returns_none_without_bars():
    now = datetime(2026, 1, 2, 1, 0, tzinfo=timezone.utc)

    assert broker_offset_from_bars([], now) is None
    assert broker_offset_from_bars(None, now) is None
    assert broker_offset_from_bars([{"time": 0}], now) is None


def test_broker_offset_from_bars_is_clamped():
    now = datetime(2026, 1, 2, 1, 0, tzinfo=timezone.utc)
    candles = [{"time": int(now.timestamp()) + 20 * 3600}]

    assert broker_offset_from_bars(candles, now) == 14 * 3600

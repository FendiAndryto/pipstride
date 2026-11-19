"""Assembled bridge status and journal reads for a single MT5 connection.

Pure reads: this module never persists telemetry. Analytics formulas come from
``app.domain.metrics`` so the dashboard and the journal cannot drift.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core import live_state
from app.core.config import settings
from app.db.models import Mt5Connection, Trade
from app.domain.metrics import compute_cash_flow, profit_factor, win_rate
from app.domain.time import (
    as_utc,
    broker_day_start_utc,
    broker_offset_from_bars,
    broker_utc_offset_seconds,
    to_unix,
)
from app.infrastructure.db.repositories import (
    cash_flow_repository,
    telemetry_repository,
    trade_repository,
)
from app.models.bridge import (
    BridgeStatusResponse,
    CashFlowItem,
    ClosedTradeItem,
    EquityCurveResponse,
    EquityPointItem,
    HeartbeatPayload,
    InitialDepositResponse,
    MarketQuoteItem,
    PositionItem,
    TradeHistoryResponse,
)
from app.services.account_settings_service import account_settings_service
from app.services.telemetry_ingest_service import telemetry_ingest_service


def _now() -> datetime:
    return datetime.now(timezone.utc)


class BridgeStatusService:
    # ------------------------------------------------------------------- reads
    def _live(self, connection: Mt5Connection) -> Optional[dict]:
        return live_state.load_live_payload(connection.id)

    def _is_fresh(self, live: Optional[dict]) -> bool:
        if not live:
            return False
        return (time.time() - float(live.get("captured_at", 0))) <= settings.HEARTBEAT_TIMEOUT_SECONDS

    def _matching_baseline_id(
        self, db: Session, connection: Mt5Connection, sensor_deposit: Optional[float]
    ) -> Optional[int]:
        """Identify the opening deposit without discarding an unmatched top-up."""
        if not sensor_deposit:
            return None
        earliest = cash_flow_repository.earliest_deposit(db, connection.id)
        if earliest is not None and abs(float(earliest.amount) - sensor_deposit) < 0.01:
            return earliest.id
        return None

    def get_status(self, db: Session, connection: Mt5Connection) -> BridgeStatusResponse:
        live = self._live(connection)
        fresh = self._is_fresh(live)
        deposit = account_settings_service.get_effective_initial_deposit(db, connection)
        overridden = account_settings_service.has_override(db, connection)

        sensor_deposit = account_settings_service.get_sensor_initial_deposit(connection)
        baseline_id = self._matching_baseline_id(db, connection, sensor_deposit)
        cash_totals = cash_flow_repository.sum_cash_flow(
            db, connection.id, exclude_id=baseline_id
        )

        if sensor_deposit:
            net_capital = round(float(deposit or 0.0) + cash_totals["net_funding"], 2)
        elif cash_totals["deposits"]:
            # No sensor baseline to anchor on: the cash rows are the only source.
            net_capital = round(float(cash_totals["net_funding"]), 2)
        else:
            net_capital = round(float(deposit or 0.0), 2)

        if not fresh:
            return BridgeStatusResponse(
                is_connected=False,
                terminal_connected=False,
                last_heartbeat_at=to_unix(connection.last_seen_at),
                seconds_since_last_heartbeat=None,
                metrics=None,
                initial_deposit=deposit,
                net_capital=net_capital,
                is_deposit_overridden=overridden,
                settled_pnl=0.0,
                settled_pnl_percent=0.0,
                all_time_pnl=0.0,
                all_time_pnl_percent=0.0,
                positions=[],
                market_quotes=[],
                closed_trades_count=telemetry_ingest_service.closed_trade_count(db, connection),
            )

        payload = HeartbeatPayload(**live["payload"])
        payload.bridge_token = None

        settled_pnl = trade_repository.sum_profit_between(db, connection.id)
        all_time_pnl = round(settled_pnl + float(payload.floating_pnl or 0.0), 2)
        settled_pnl_pct = (
            round((settled_pnl / net_capital) * 100.0, 2) if net_capital > 0 else 0.0
        )
        all_time_pnl_pct = (
            round((all_time_pnl / net_capital) * 100.0, 2) if net_capital > 0 else 0.0
        )

        return BridgeStatusResponse(
            is_connected=True,
            terminal_connected=payload.terminal_connected,
            last_heartbeat_at=int(live.get("captured_at", 0)),
            seconds_since_last_heartbeat=round(time.time() - float(live.get("captured_at", 0)), 2),
            metrics=payload,
            initial_deposit=deposit,
            net_capital=net_capital,
            is_deposit_overridden=overridden,
            settled_pnl=settled_pnl,
            settled_pnl_percent=settled_pnl_pct,
            all_time_pnl=all_time_pnl,
            all_time_pnl_percent=all_time_pnl_pct,
            positions=payload.positions,
            market_quotes=payload.market_quotes,
            chart_symbol=payload.chart_symbol,
            closed_trades_count=telemetry_ingest_service.closed_trade_count(db, connection),
            host_type=payload.host_type or "local",
        )

    def get_positions(self, connection: Mt5Connection) -> List[PositionItem]:
        live = self._live(connection)
        if not self._is_fresh(live):
            return []
        return list(HeartbeatPayload(**live["payload"]).positions)

    def get_market_quotes(self, connection: Mt5Connection) -> List[MarketQuoteItem]:
        live = self._live(connection)
        if not live:
            return []
        return list(HeartbeatPayload(**live["payload"]).market_quotes)

    def get_trade_history(
        self,
        db: Session,
        connection: Mt5Connection,
        limit: int = 1000,
        offset: int = 0,
    ) -> TradeHistoryResponse:
        scope = Trade.connection_id == connection.id

        # Aggregates are computed in SQL so pagination never loads the whole
        # table into memory.
        summary = db.execute(
            select(
                func.count(Trade.id),
                func.coalesce(func.sum(case((Trade.profit > 0, Trade.profit), else_=0.0)), 0.0),
                func.coalesce(func.sum(case((Trade.profit < 0, Trade.profit), else_=0.0)), 0.0),
                func.count(case((Trade.profit > 0, Trade.id))),
                func.count(case((Trade.profit < 0, Trade.id))),
            ).where(scope)
        ).one()
        total, gross_profit, gross_loss, wins, losses = (
            int(summary[0]),
            round(float(summary[1]), 2),
            round(float(summary[2]), 2),
            int(summary[3]),
            int(summary[4]),
        )

        rows = list(
            db.scalars(
                select(Trade)
                .where(scope)
                .order_by(Trade.closed_at.desc().nullslast())
                .limit(max(1, min(int(limit or 1000), 5000)))
                .offset(max(0, int(offset or 0)))
            )
        )

        trades = [
            ClosedTradeItem(
                ticket=row.ticket,
                symbol=row.symbol,
                type=row.direction,
                volume=row.volume,
                open_price=row.open_price,
                close_price=row.close_price,
                profit=row.profit,
                open_time=to_unix(row.opened_at) or 0,
                close_time=to_unix(row.closed_at) or 0,
                magic=row.magic,
            )
            for row in rows
        ]

        # Cash flow is returned beside the trades and is never merged into them:
        # the journal renders the two streams separately.
        cash_rows = cash_flow_repository.list_cash_flow(
            db, connection.id, limit=5000, offset=0
        )
        cash_flow_items = [
            CashFlowItem(
                ticket=row.ticket,
                category=row.category,
                profit=row.amount,
                time=to_unix(row.occurred_at) or 0,
            )
            for row in cash_rows
        ]
        cash_totals = compute_cash_flow(cash_rows)

        net_pnl = round(gross_profit + gross_loss, 2)
        return TradeHistoryResponse(
            trades=trades,
            cash_flow=cash_flow_items,
            total_deposits=cash_totals["deposits"],
            total_withdrawals=cash_totals["withdrawals"],
            net_funding=cash_totals["net_funding"],
            net_pnl=net_pnl,
            win_rate=win_rate(wins, total),
            profit_factor=profit_factor(gross_profit, gross_loss),
            total_trades=total,
            winning_trades=wins,
            losing_trades=losses,
            gross_profit=gross_profit,
            gross_loss=gross_loss,
            account_number=connection.account_number,
            server=connection.broker_server,
        )

    def get_equity_curve(
        self, db: Session, connection: Mt5Connection, time_range: str = "1M"
    ) -> EquityCurveResponse:
        range_norm = (time_range or "").strip().upper()
        if range_norm in ("DAY", "1D", "D", "TODAY"):
            period_label = "Day"
            days: Optional[int] = 1
        elif range_norm in ("WEEK", "1W", "W"):
            period_label = "Week"
            days = 7
        elif range_norm in ("MONTH", "1M", "M"):
            period_label = "Month"
            days = 30
        elif range_norm in ("3M", "QUARTER"):
            period_label = "3M"
            days = 90
        elif range_norm in ("1Y", "YEAR"):
            period_label = "1Y"
            days = 365
        elif range_norm in ("ALL", "MAX"):
            period_label = "ALL"
            days = None
        else:
            period_label = "Month"
            days = 30

        now = _now()
        since = now - timedelta(days=days) if days is not None else None

        deposit = account_settings_service.get_effective_initial_deposit(db, connection)
        if not deposit or deposit <= 0:
            deposit = 500.0

        cash_events = self._cash_flow_timeline(db, connection)

        # Fetch the selected window from PostgreSQL and aggregate the baseline
        # in SQL. The previous version loaded every trade the account ever made.
        trade_filter = [Trade.connection_id == connection.id]
        if since is not None:
            prior_pnl = db.scalar(
                select(func.coalesce(func.sum(Trade.profit), 0.0)).where(
                    *trade_filter, Trade.closed_at < since
                )
            )
            prior_cash = sum(
                amount for moment, amount in cash_events if moment and moment < since
            )
            period_trades = list(
                db.scalars(
                    select(Trade)
                    .where(*trade_filter, Trade.closed_at >= since)
                    .order_by(Trade.closed_at.asc(), Trade.id.asc())
                )
            )
        else:
            prior_pnl = 0.0
            prior_cash = 0.0
            period_trades = list(
                db.scalars(
                    select(Trade)
                    .where(*trade_filter)
                    .order_by(Trade.closed_at.asc().nulls_last(), Trade.id.asc())
                )
            )

        # Baseline equity at the beginning of the selected window
        period_start_equity = round(
            deposit + float(prior_pnl or 0.0) + float(prior_cash or 0.0), 2
        )
        running_equity = period_start_equity

        points: List[EquityPointItem] = []

        if since:
            period_start_ts = int(since.timestamp())
        else:
            # The ALL range opens at the earliest event of either kind: a
            # deposit or withdrawal can predate the first closed trade, and a
            # point drawn before the start would make the curve non-monotonic.
            moments = [as_utc(t.closed_at) for t in period_trades if t.closed_at]
            moments += [moment for moment, _ in cash_events if moment]
            period_start_ts = (
                int((min(moments) - timedelta(minutes=5)).timestamp())
                if moments
                else int((now - timedelta(days=1)).timestamp())
            )

        # Baseline starting point
        points.append(EquityPointItem(timestamp=period_start_ts, equity=period_start_equity, balance=period_start_equity))

        # One merged timeline: trading results and cash movements both move the
        # balance, and interleaving them is what makes a withdrawal a step down
        # instead of a fake trading drawdown.
        events: List[tuple] = []
        for t in period_trades:
            events.append((as_utc(t.closed_at) or since or now, float(t.profit or 0.0)))
        for moment, amount in cash_events:
            if moment is None:
                continue
            if since is not None and moment < since:
                continue
            events.append((moment, amount))
        events.sort(key=lambda item: item[0])

        for moment, delta in events:
            running_equity = round(running_equity + delta, 2)
            points.append(
                EquityPointItem(
                    timestamp=to_unix(moment) or period_start_ts,
                    equity=running_equity,
                    balance=running_equity,
                )
            )

        # Append latest live equity point
        live = self._live(connection)
        current_equity = running_equity
        if live and "payload" in live:
            p = live["payload"]
            live_eq = float(p.get("equity", running_equity))
            live_bal = float(p.get("balance", running_equity))
            current_equity = live_eq
            points.append(EquityPointItem(timestamp=to_unix(now) or int(now.timestamp()), equity=live_eq, balance=live_bal))
        elif len(points) == 1:
            points.append(EquityPointItem(timestamp=to_unix(now) or int(now.timestamp()), equity=running_equity, balance=running_equity))

        starting_equity = points[0].equity if points else period_start_equity
        current_equity = points[-1].equity if points else period_start_equity
        peak = max((p.equity for p in points), default=current_equity)

        return EquityCurveResponse(
            period=period_label,
            starting_equity=starting_equity,
            initial_deposit=deposit,
            current_equity=current_equity,
            peak_equity=peak,
            all_time_pnl=round(current_equity - starting_equity, 2),
            roi_percent=round(((current_equity - starting_equity) / starting_equity) * 100.0, 2) if starting_equity > 0 else 0.0,
            account_number=connection.account_number,
            server=connection.broker_server,
            points=points,
        )

    # --------------------------------------------------------- initial deposit
    def get_initial_deposit_info(
        self, db: Session, connection: Mt5Connection
    ) -> InitialDepositResponse:
        effective = account_settings_service.get_effective_initial_deposit(db, connection)
        overridden = account_settings_service.has_override(db, connection)
        status_response = self.get_status(db, connection)

        return InitialDepositResponse(
            initial_deposit=effective,
            is_overridden=overridden,
            source="override" if overridden else "mt5",
            settled_pnl=status_response.settled_pnl,
            settled_pnl_percent=status_response.settled_pnl_percent,
            all_time_pnl=status_response.all_time_pnl,
            all_time_pnl_percent=status_response.all_time_pnl_percent,
            message="Initial deposit baseline loaded.",
        )

    # ------------------------------------------------------ daily / overall DD
    def broker_offset(self, connection: Mt5Connection, metrics: Optional[HeartbeatPayload]) -> int:
        """Broker-minus-UTC offset in seconds, cached per connection.

        The trading day rolls over at the broker's midnight, so the offset has to
        come from a *server* clock. Two sources qualify, in order:

        ``broker_time``
            ``TimeCurrent()``, sent explicitly by the current EA build. Exact.

        candle open times
            ``MqlRates.time`` is server-stamped too. This is what keeps an older
            EA build (which sends no ``broker_time``) on the right day.

        The payload's ``timestamp`` is deliberately *not* used: it is
        ``TimeLocal()``, the trader's PC clock. Trusting it put the boundary at
        the PC's midnight — 7 hours off for a UTC+7 trader on a UTC server —
        which is the exact failure this module exists to prevent.

        The cache covers the stale case: ``get_status`` returns ``metrics=None``
        once the bridge goes quiet, and without it the offset would fall back to
        UTC and move the day boundary by hours exactly when nobody is watching.
        """
        cached = live_state.load_broker_offset(connection.id)
        now = _now()

        broker_time = getattr(metrics, "broker_time", None) if metrics else None
        if broker_time:
            derived = broker_utc_offset_seconds(broker_time, now)
            live_state.save_broker_offset(
                connection.id, derived, settings.BROKER_OFFSET_CACHE_SECONDS
            )
            return derived

        if metrics is not None:
            bars = list(getattr(metrics, "candles_m5", None) or []) or list(
                getattr(metrics, "candles", None) or []
            )
            from_bars = broker_offset_from_bars(bars, now)
            if from_bars is not None:
                live_state.save_broker_offset(
                    connection.id, from_bars, settings.BROKER_OFFSET_CACHE_SECONDS
                )
                return from_bars

        return cached if cached is not None else 0

    def get_daily_anchor(
        self,
        db: Session,
        connection: Mt5Connection,
        metrics: Optional[HeartbeatPayload],
        deposit: Optional[float],
    ) -> dict:
        """Start-of-broker-day equity anchor.

        Two informative rungs, then an honest fallback:

        ``snapshot_exact`` / ``snapshot_rollforward``
            A snapshot exists at or before the boundary. The anchor carries the
            floating P&L that was already open at rollover, so a position held
            across midnight does not fabricate a drawdown at 00:00 broker time —
            which is the bug this replaces.

        ``deposit_reconstruction``
            No snapshot covers the boundary. The anchor is the capital the
            account actually held at midnight: net cash funding up to the
            boundary plus everything realized up to it.

        ``current_fallback``
            No snapshot and no usable baseline: the anchor is the live equity,
            so the report is an honest 0% instead of a derived guess. A
            withdrawn account leaves both anchors unset.

        Deliberately *not* derived from the current balance: that anchor is
        circular (it always yields ``floating / balance`` as "daily drawdown"),
        which is exactly the wrong number this ticket removes.

        Every anchored branch is then shifted by the cash that moved *after* the
        moment the anchor value was true (spec 008). A deposit raises the capital
        at risk; a withdrawal lowers it. Without that shift a $1,700 withdrawal
        on a $1,925.39 anchor reported 88.29% daily drawdown while no trade had
        lost anything. ``current_fallback`` is exempt: its anchor *is* the live
        equity, so shifting it would reintroduce the circularity.
        """
        now = _now()
        offset = self.broker_offset(connection, metrics)
        boundary = broker_day_start_utc(now, offset)

        current_balance = float(getattr(metrics, "balance", 0.0) or 0.0)
        current_equity = getattr(metrics, "equity", None)
        current_equity = float(current_equity) if current_equity is not None else None

        anchor: dict = {
            "at": boundary,
            "balance": None,
            "equity": None,
            "source": "current_fallback",
            "broker_offset_seconds": offset,
            "anchor_moment": boundary,
            "net_cash_flow": 0.0,
            "raw_equity": None,
        }

        snapshot = telemetry_repository.snapshot_at_or_before(db, connection.id, boundary)
        if snapshot is not None and (snapshot.balance or 0) > 0:
            captured_at = as_utc(snapshot.captured_at) or boundary
            stale_seconds = (boundary - captured_at).total_seconds()

            if stale_seconds <= 90:
                anchor.update(
                    balance=round(float(snapshot.balance), 2),
                    equity=round(float(snapshot.equity or snapshot.balance), 2),
                    source="snapshot_exact",
                    anchor_moment=captured_at,
                )
                return self._apply_cash_flow(db, connection, anchor)

            # Roll the stale snapshot forward: equity at the boundary is the
            # snapshot equity plus everything realized in between. The floating
            # component of the snapshot is kept because it was open at rollover.
            drift = trade_repository.sum_profit_between(
                db, connection.id, after=captured_at, until=boundary
            )
            anchor.update(
                balance=round(float(snapshot.balance) + drift, 2),
                equity=round(float(snapshot.equity or snapshot.balance) + drift, 2),
                source="snapshot_rollforward",
            )
            return self._apply_cash_flow(db, connection, anchor)

        # The EA was not running across midnight (new install, terminal closed,
        # bridge added mid-day). The first observation of today is the honest
        # anchor: it is observed, not derived, and it measures the day from the
        # moment monitoring actually started.
        first_today = telemetry_repository.snapshot_at_or_after(db, connection.id, boundary)
        if first_today is not None and (first_today.balance or 0) > 0:
            anchor.update(
                balance=round(float(first_today.balance), 2),
                equity=round(float(first_today.equity or first_today.balance), 2),
                source="session_start",
                anchor_moment=as_utc(first_today.captured_at) or boundary,
            )
            return self._apply_cash_flow(db, connection, anchor)

        if deposit and deposit > 0:
            reconstructed = self._reconstruct_capital(db, connection, deposit, boundary)
            # A non-positive reconstruction means the capital was withdrawn
            # before the day started. Forcing a positive anchor then reported a
            # fabricated 100% daily drawdown (spec 009), so the account falls
            # through to the unset-anchor fallback instead.
            if reconstructed > 0:
                anchor.update(
                    balance=reconstructed,
                    equity=reconstructed,
                    source="deposit_reconstruction",
                )
                return self._apply_cash_flow(db, connection, anchor)

        # Nothing is at risk on a withdrawn account: both anchors stay unset so
        # the policy reports 0% instead of measuring against a fabricated basis.
        fallback_equity = (
            round(current_equity, 2)
            if current_equity is not None and current_equity > 0
            else None
        )
        anchor.update(
            balance=round(current_balance, 2) if current_balance > 0 else None,
            equity=fallback_equity,
            source="current_fallback",
        )
        return anchor

    def _reconstruct_capital(
        self,
        db: Session,
        connection: Mt5Connection,
        deposit: float,
        boundary: datetime,
    ) -> float:
        """Rebuild capital from historical funding and realized P&L (spec 009)."""
        realized = trade_repository.sum_profit_between(db, connection.id, until=boundary)
        overridden = account_settings_service.has_override(db, connection)
        sensor_deposit = account_settings_service.get_sensor_initial_deposit(connection)
        baseline_id = self._matching_baseline_id(db, connection, sensor_deposit)
        if not sensor_deposit:
            # Older heartbeats omit the sensor value. Preserve the historical
            # anchor rule that uses the first recorded deposit as the baseline.
            earliest = cash_flow_repository.earliest_deposit(db, connection.id)
            baseline_id = earliest.id if earliest is not None else None
        if not sensor_deposit and baseline_id is None:
            return round(deposit + realized, 2)

        summary = cash_flow_repository.sum_cash_flow(
            db,
            connection.id,
            until=boundary,
            exclude_id=baseline_id if overridden else None,
        )
        if overridden or (sensor_deposit and baseline_id is None):
            return round(deposit + summary["net_funding"] + realized, 2)
        # Use the recorded time of the opening deposit for historical anchors.
        return round(summary["net_funding"] + realized, 2)

    def _apply_cash_flow(
        self, db: Session, connection: Mt5Connection, anchor: dict
    ) -> dict:
        """Shift a daily anchor by the cash moved since ``anchor_moment``.

        ``net_cash_flow`` lands on the anchor so the route can expose why the
        anchor differs from the observed value, and ``raw_equity`` keeps the
        observation itself for the trough segmentation.
        """
        moment = anchor.get("anchor_moment") or anchor["at"]
        summary = cash_flow_repository.sum_cash_flow(db, connection.id, since=moment)
        net = float(summary["net_funding"] or 0.0)

        anchor["net_cash_flow"] = net
        anchor["anchor_moment"] = moment

        if anchor["equity"] is not None:
            raw_equity = round(float(anchor["equity"]), 2)
            anchor["raw_equity"] = raw_equity
            # A withdrawal can empty the account; 0.0 is then the honest basis
            # and the policy reports a clean 0% instead of a divide-by-zero.
            anchor["equity"] = max(0.0, round(raw_equity + net, 2))

        if anchor["balance"] is not None:
            anchor["balance"] = max(0.0, round(float(anchor["balance"]) + net, 2))

        return anchor

    def _cash_flow_timeline(
        self, db: Session, connection: Mt5Connection
    ) -> List[tuple[datetime, float]]:
        """Return cash movements with the matched opening deposit excluded."""
        sensor_deposit = account_settings_service.get_sensor_initial_deposit(connection)
        baseline_id = self._matching_baseline_id(db, connection, sensor_deposit)

        return [
            (as_utc(occurred_at), float(amount or 0.0))
            for event_id, amount, occurred_at in cash_flow_repository.cash_flow_events(
                db, connection.id
            )
            if event_id != baseline_id and occurred_at is not None
        ]

    def get_overall_drawdown(
        self,
        db: Session,
        connection: Mt5Connection,
        current_equity: Optional[float],
        deposit: Optional[float],
    ) -> dict:
        """Peak-to-trough drawdown over the whole reconstructed history.

        Equity is rebuilt from the stored trades with cash movements interleaved
        as step events (the same reconciliation ``get_equity_curve`` uses), then
        the live equity is appended as the newest point. Nothing is extrapolated:
        an empty history reports the live equity as its own peak.

        Peak, trough and current equity are all evaluated on the **trade-only**
        basis (equity minus the cash moved so far), so a withdrawal steps the
        baseline down instead of leaving a permanent peak-to-trough drawdown
        behind it -- the false overall drawdown of spec 008. Deposits are shifted
        out the same way: they are capital, not performance.
        """
        base = float(deposit) if deposit and deposit > 0 else 0.0

        events: List[tuple[datetime, float, bool]] = [
            (as_utc(closed_at) or _now(), float(profit or 0.0), False)
            for profit, closed_at in trade_repository.profit_points(db, connection.id)
        ]
        events += [
            (moment, amount, True)
            for moment, amount in self._cash_flow_timeline(db, connection)
        ]
        events.sort(key=lambda item: item[0])

        equity = base
        cum_cash = 0.0
        peak = base
        peak_at = None
        trough_after_peak = base

        for moment, delta, is_cash in events:
            equity = round(equity + delta, 2)
            if is_cash:
                cum_cash = round(cum_cash + delta, 2)
            trade_only = round(equity - cum_cash, 2)
            if trade_only > peak:
                peak = trade_only
                peak_at = to_unix(moment)
                trough_after_peak = peak
            elif trade_only < trough_after_peak:
                trough_after_peak = trade_only

        current = None
        if current_equity is not None:
            current = round(float(current_equity) - cum_cash, 2)
            if current > peak:
                peak = current
                peak_at = to_unix(_now())
                trough_after_peak = current
            elif current < trough_after_peak:
                trough_after_peak = current

        return {
            "peak_equity": round(peak, 2) if peak > 0 else None,
            "peak_equity_at": peak_at,
            "trough_equity": round(trough_after_peak, 2) if trough_after_peak > 0 else None,
            "current_equity": current,
        }

    def get_daily_trough(
        self, db: Session, connection: Mt5Connection, anchor: dict
    ) -> Optional[float]:
        """Worst intraday trading drawdown, expressed on the adjusted anchor basis.

        The day is split into segments at every cash movement. Each segment is
        measured against the capital that actually existed while it ran
        (``raw_equity`` plus the cash moved before that segment), because the two
        halves of a withdrawal are not comparable: $1,700 leaving a $1,925.39
        account leaves $225.39 of capital, and holding $225.39 is not a drawdown.

        The result is a trough value on the final adjusted basis so that
        ``policies.evaluate_drawdown`` reproduces the worst segment percentage
        unchanged: ``adjusted * (1 - worst / 100)``. With no cash flow today this
        is exactly the historical snapshot minimum.
        """
        adjusted = anchor.get("equity")
        raw = anchor.get("raw_equity")
        moment = anchor.get("anchor_moment") or anchor.get("at")
        if moment is None:
            return None
        if raw is None:
            raw = adjusted
        if raw is None:
            return None

        now = _now()
        cash = [
            (moment_at, amount)
            for moment_at, amount in self._cash_flow_timeline(db, connection)
            if moment_at >= moment
        ]
        cash.sort(key=lambda item: item[0])

        worst: Optional[float] = None
        capital = float(raw)
        for index in range(len(cash) + 1):
            start = moment if index == 0 else cash[index - 1][0]
            end = cash[index][0] if index < len(cash) else now
            if start < end:
                minimum = telemetry_repository.equity_minimum_between(
                    db, connection.id, start, end
                )
                if minimum is not None and capital > 0:
                    loss = max(0.0, ((capital - float(minimum)) / capital) * 100.0)
                    worst = loss if worst is None else max(worst, loss)
            if index < len(cash):
                # The cash that closes this segment sets the next one's capital.
                capital = round(capital + cash[index][1], 2)

        if worst is None or adjusted is None or adjusted <= 0:
            return None
        return round(float(adjusted) * (1 - worst / 100.0), 2)


bridge_status_service = BridgeStatusService()

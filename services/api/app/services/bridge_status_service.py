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
from app.domain.metrics import profit_factor, win_rate
from app.domain.time import to_unix
from app.infrastructure.db.repositories import telemetry_repository
from app.models.bridge import (
    BridgeStatusResponse,
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

    def get_status(self, db: Session, connection: Mt5Connection) -> BridgeStatusResponse:
        live = self._live(connection)
        fresh = self._is_fresh(live)
        deposit = account_settings_service.get_effective_initial_deposit(db, connection)
        overridden = account_settings_service.has_override(db, connection)

        if not fresh:
            return BridgeStatusResponse(
                is_connected=False,
                terminal_connected=False,
                last_heartbeat_at=to_unix(connection.last_seen_at),
                seconds_since_last_heartbeat=None,
                metrics=None,
                initial_deposit=deposit,
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

        balance = payload.balance
        equity = payload.equity
        settled_pnl = round(balance - deposit, 2) if deposit else 0.0
        settled_pnl_pct = round((settled_pnl / deposit) * 100.0, 2) if deposit else 0.0
        all_time_pnl = round(equity - deposit, 2) if deposit else 0.0
        all_time_pnl_pct = round((all_time_pnl / deposit) * 100.0, 2) if deposit else 0.0

        return BridgeStatusResponse(
            is_connected=True,
            terminal_connected=payload.terminal_connected,
            last_heartbeat_at=int(live.get("captured_at", 0)),
            seconds_since_last_heartbeat=round(time.time() - float(live.get("captured_at", 0)), 2),
            metrics=payload,
            initial_deposit=deposit,
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

        net_pnl = round(gross_profit + gross_loss, 2)
        return TradeHistoryResponse(
            trades=trades,
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

        # Fetch the selected window from PostgreSQL and aggregate the baseline
        # in SQL. The previous version loaded every trade the account ever made.
        trade_filter = [Trade.connection_id == connection.id]
        if since is not None:
            prior_pnl = db.scalar(
                select(func.coalesce(func.sum(Trade.profit), 0.0)).where(
                    *trade_filter, Trade.closed_at < since
                )
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
            period_trades = list(
                db.scalars(
                    select(Trade)
                    .where(*trade_filter)
                    .order_by(Trade.closed_at.asc().nulls_last(), Trade.id.asc())
                )
            )

        # Baseline equity at the beginning of the selected window
        period_start_equity = round(deposit + float(prior_pnl or 0.0), 2)
        running_equity = period_start_equity

        points: List[EquityPointItem] = []

        if since:
            period_start_ts = int(since.timestamp())
        elif period_trades and period_trades[0].closed_at:
            period_start_ts = int((period_trades[0].closed_at - timedelta(minutes=5)).timestamp())
        else:
            period_start_ts = int((now - timedelta(days=1)).timestamp())

        # Baseline starting point
        points.append(EquityPointItem(timestamp=period_start_ts, equity=period_start_equity, balance=period_start_equity))

        for t in period_trades:
            running_equity = round(running_equity + (t.profit or 0.0), 2)
            t_time = to_unix(t.closed_at) or period_start_ts
            points.append(EquityPointItem(timestamp=t_time, equity=running_equity, balance=running_equity))

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

    def get_daily_starting_balance(
        self, db: Session, connection: Mt5Connection, current_balance: float
    ) -> float:
        """Calculate start-of-day balance (total saldo awal saat ganti hari).

        At each day rollover (00:00:00 UTC), the daily baseline is the account balance
        at that exact moment. For the active day, it is reconstructed by subtracting
        the net profits of trades closed today from the current balance.
        If a TelemetrySnapshot exists on or before today's start, it is used as verification.
        """
        now = _now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        # 1. Check for snapshot recorded on or before today's start
        snapshot = telemetry_repository.balance_at_or_before(db, connection.id, today_start)
        if snapshot is not None and snapshot > 0:
            return round(float(snapshot), 2)

        # 2. Reconstruct from trades closed today: balance_start = balance_current - today_profits
        trades_today = list(
            db.scalars(
                select(Trade).where(
                    Trade.connection_id == connection.id,
                    Trade.closed_at >= today_start,
                )
            )
        )
        today_profit = sum((t.profit or 0.0) for t in trades_today)
        computed_start = round(current_balance - today_profit, 2)
        if computed_start > 0:
            return computed_start

        return current_balance if current_balance > 0 else 500.0


bridge_status_service = BridgeStatusService()

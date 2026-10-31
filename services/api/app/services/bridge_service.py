"""Telemetry ingest and journal reads for a single MT5 connection.

Pipstride is strictly read-only: this module persists what the MT5 monitor
reports and never sends execution commands back to the terminal.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import live_state
from app.core.config import settings
from app.db.models import AccountSettings, Mt5Connection, TelemetrySnapshot, Trade
from app.models.bridge import (
    BridgeStatusResponse,
    ClosedTradeItem,
    EquityCurveResponse,
    EquityPointItem,
    HeartbeatPayload,
    HeartbeatResponse,
    InitialDepositResponse,
    MarketQuoteItem,
    PositionItem,
    TradeHistoryResponse,
)
from app.services.connection_service import connection_service

SNAPSHOT_MIN_INTERVAL_SECONDS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_dt(ts: Optional[int]) -> Optional[datetime]:
    if ts is None:
        return None
    return datetime.fromtimestamp(int(ts), tz=timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Normalise datetimes across backends.

    PostgreSQL returns timezone-aware values, SQLite returns naive ones. Mixing
    the two raises ``TypeError`` on subtraction, so anything read back from the
    database goes through here before being compared or converted.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _ts(value: Optional[datetime]) -> Optional[int]:
    normalised = _as_utc(value)
    return int(normalised.timestamp()) if normalised else None


class BridgeService:
    # ------------------------------------------------------------------ ingest
    def process_heartbeat(
        self,
        db: Session,
        payload: HeartbeatPayload,
        raw_token: Optional[str],
    ) -> HeartbeatResponse:
        connection = connection_service.get_by_token(db, raw_token or "")
        if connection is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or revoked connection token.",
            )

        try:
            connection_service.bind_account(
                db,
                connection,
                account_number=payload.account_number,
                broker_server=payload.server,
                currency=payload.currency,
            )
        except Exception as exc:  # ConnectionBindingError
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(exc),
            )

        connection.last_seen_at = _now()
        connection.status = "connected"

        self._persist_snapshot(db, connection, payload)
        self._persist_trades(db, connection, payload)

        payload_data = payload.model_dump(mode="json")
        payload_data.pop("bridge_token", None)
        live_state.save_live_payload(
            connection.id,
            {
                "captured_at": int(time.time()),
                "payload": payload_data,
            },
        )

        db.commit()

        return HeartbeatResponse(status="ok", server_time=int(time.time()))

    def _persist_snapshot(self, db: Session, connection: Mt5Connection, payload: HeartbeatPayload) -> None:
        latest = db.scalar(
            select(TelemetrySnapshot)
            .where(TelemetrySnapshot.connection_id == connection.id)
            .order_by(TelemetrySnapshot.captured_at.desc())
            .limit(1)
        )
        if latest is not None:
            age = (_now() - _as_utc(latest.captured_at)).total_seconds()
            if age < SNAPSHOT_MIN_INTERVAL_SECONDS:
                return

        db.add(
            TelemetrySnapshot(
                connection_id=connection.id,
                balance=payload.balance,
                equity=payload.equity,
                margin=payload.margin,
                free_margin=payload.free_margin,
                margin_level=payload.margin_level,
                floating_pnl=payload.floating_pnl,
                open_positions=payload.open_positions,
            )
        )

    def _persist_trades(self, db: Session, connection: Mt5Connection, payload: HeartbeatPayload) -> None:
        if not payload.closed_trades:
            return

        existing = set(
            db.scalars(
                select(Trade.ticket).where(Trade.connection_id == connection.id)
            )
        )
        for item in payload.closed_trades:
            if item.ticket in existing:
                continue
            db.add(
                Trade(
                    connection_id=connection.id,
                    ticket=item.ticket,
                    symbol=item.symbol,
                    direction=item.type,
                    volume=item.volume,
                    open_price=item.open_price,
                    close_price=item.close_price,
                    profit=item.profit,
                    magic=item.magic,
                    opened_at=_to_dt(item.open_time),
                    closed_at=_to_dt(item.close_time),
                )
            )
            existing.add(item.ticket)

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
        deposit = self.get_effective_initial_deposit(db, connection)

        if not fresh:
            return BridgeStatusResponse(
                is_connected=False,
                terminal_connected=False,
                last_heartbeat_at=_ts(connection.last_seen_at),
                seconds_since_last_heartbeat=None,
                metrics=None,
                initial_deposit=deposit,
                is_deposit_overridden=self._has_override(db, connection),
                settled_pnl=0.0,
                settled_pnl_percent=0.0,
                all_time_pnl=0.0,
                all_time_pnl_percent=0.0,
                positions=[],
                market_quotes=[],
                closed_trades_count=self._closed_trade_count(db, connection),
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
            is_deposit_overridden=self._has_override(db, connection),
            settled_pnl=settled_pnl,
            settled_pnl_percent=settled_pnl_pct,
            all_time_pnl=all_time_pnl,
            all_time_pnl_percent=all_time_pnl_pct,
            positions=payload.positions,
            market_quotes=payload.market_quotes,
            chart_symbol=payload.chart_symbol,
            closed_trades_count=self._closed_trade_count(db, connection),
            host_type=payload.host_type or "local",
        )

    def _closed_trade_count(self, db: Session, connection: Mt5Connection) -> int:
        return int(
            db.scalar(
                select(func.count(Trade.id)).where(Trade.connection_id == connection.id)
            )
            or 0
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

    def get_trade_history(self, db: Session, connection: Mt5Connection) -> TradeHistoryResponse:
        rows = list(
            db.scalars(
                select(Trade)
                .where(Trade.connection_id == connection.id)
                .order_by(Trade.closed_at.desc().nullslast())
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
                open_time=_ts(row.opened_at) or 0,
                close_time=_ts(row.closed_at) or 0,
                magic=row.magic,
            )
            for row in rows
        ]

        gross_profit = round(sum(t.profit for t in trades if t.profit > 0), 2)
        gross_loss = round(sum(t.profit for t in trades if t.profit < 0), 2)
        net_pnl = round(gross_profit + gross_loss, 2)
        wins = sum(1 for t in trades if t.profit > 0)
        losses = sum(1 for t in trades if t.profit < 0)
        total = len(trades)

        return TradeHistoryResponse(
            trades=trades,
            net_pnl=net_pnl,
            win_rate=round((wins / total) * 100.0, 2) if total else 0.0,
            profit_factor=round(gross_profit / abs(gross_loss), 2) if gross_loss else None,
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

        deposit = self.get_effective_initial_deposit(db, connection)
        if not deposit or deposit <= 0:
            deposit = 500.0

        # Fetch closed trades for this connection ordered chronologically
        all_trades = list(
            db.scalars(
                select(Trade)
                .where(Trade.connection_id == connection.id)
                .order_by(Trade.closed_at.asc().nulls_last(), Trade.id.asc())
            )
        )

        prior_trades = [t for t in all_trades if since and t.closed_at and t.closed_at < since]
        period_trades = [t for t in all_trades if not since or (t.closed_at and t.closed_at >= since)]

        # Baseline equity at the beginning of the selected window
        period_start_equity = round(deposit + sum((t.profit or 0.0) for t in prior_trades), 2)
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
            t_time = _ts(t.closed_at) or period_start_ts
            points.append(EquityPointItem(timestamp=t_time, equity=running_equity, balance=running_equity))

        # Append latest live equity point
        live = self._live(connection)
        current_equity = running_equity
        if live and "payload" in live:
            p = live["payload"]
            live_eq = float(p.get("equity", running_equity))
            live_bal = float(p.get("balance", running_equity))
            current_equity = live_eq
            points.append(EquityPointItem(timestamp=_ts(now) or int(now.timestamp()), equity=live_eq, balance=live_bal))
        elif len(points) == 1:
            points.append(EquityPointItem(timestamp=_ts(now) or int(now.timestamp()), equity=running_equity, balance=running_equity))

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
    def _has_override(self, db: Session, connection: Mt5Connection) -> bool:
        row = db.get(AccountSettings, connection.id)
        return bool(row and row.custom_initial_deposit and row.custom_initial_deposit > 0)

    def get_effective_initial_deposit(self, db: Session, connection: Mt5Connection) -> Optional[float]:
        row = db.get(AccountSettings, connection.id)
        if row and row.custom_initial_deposit and row.custom_initial_deposit > 0:
            return float(row.custom_initial_deposit)

        live = self._live(connection)
        if live:
            payload = HeartbeatPayload(**live["payload"])
            if payload.initial_deposit and payload.initial_deposit > 0:
                return float(payload.initial_deposit)
            if payload.balance > 0:
                return float(payload.balance)
        return None

    def get_initial_deposit_info(self, db: Session, connection: Mt5Connection) -> InitialDepositResponse:
        effective = self.get_effective_initial_deposit(db, connection)
        overridden = self._has_override(db, connection)
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

    def set_initial_deposit_override(
        self, db: Session, connection: Mt5Connection, amount: Optional[float]
    ) -> InitialDepositResponse:
        row = db.get(AccountSettings, connection.id)
        if row is None:
            row = AccountSettings(connection_id=connection.id)
            db.add(row)

        row.custom_initial_deposit = float(amount) if amount and amount > 0 else None
        db.commit()

        return self.get_initial_deposit_info(db, connection)

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
        snapshot = db.scalar(
            select(TelemetrySnapshot.balance)
            .where(
                TelemetrySnapshot.connection_id == connection.id,
                TelemetrySnapshot.captured_at <= today_start,
            )
            .order_by(TelemetrySnapshot.captured_at.desc())
            .limit(1)
        )
        if snapshot is not None and snapshot > 0:
            return round(float(snapshot), 2)

        # 2. Reconstruct from trades closed today: balance_start = balance_current - today_profits
        trades_today = list(
            db.scalars(
                select(Trade)
                .where(
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

    def reset_journal(self, db: Session, connection: Mt5Connection) -> dict:
        db.query(Trade).filter(Trade.connection_id == connection.id).delete()
        db.query(TelemetrySnapshot).filter(
            TelemetrySnapshot.connection_id == connection.id
        ).delete()
        db.commit()
        return {
            "status": "success",
            "message": "Riwayat jurnal dihapus. Data akan tersinkron ulang dari MT5.",
            "account_number": connection.account_number,
        }

    # ----------------------------------------------------------------- guards
    def submit_order(self, *args, **kwargs):
        """Pure read-only enforcement: execution is permanently disabled."""
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Pipstride is a 100% Pure Read-Only Journal platform. "
            "Trade execution and liquidations are disabled.",
        )


bridge_service = BridgeService()

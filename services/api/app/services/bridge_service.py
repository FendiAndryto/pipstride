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
    if not ts:
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

        live_state.save_live_payload(
            connection.id,
            {
                "captured_at": int(time.time()),
                "payload": payload.model_dump(mode="json"),
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
            profit_factor=round(gross_profit / abs(gross_loss), 2) if gross_loss else 0.0,
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
        days = {"1D": 1, "1W": 7, "1M": 30, "3M": 90, "1Y": 365}.get(time_range.upper(), 30)
        since = _now() - timedelta(days=days)

        rows = list(
            db.scalars(
                select(TelemetrySnapshot)
                .where(
                    TelemetrySnapshot.connection_id == connection.id,
                    TelemetrySnapshot.captured_at >= since,
                )
                .order_by(TelemetrySnapshot.captured_at)
            )
        )

        points = [
            EquityPointItem(
                timestamp=_ts(row.captured_at) or 0,
                equity=row.equity,
                balance=row.balance,
            )
            for row in rows
        ]

        deposit = self.get_effective_initial_deposit(db, connection)
        current_equity = points[-1].equity if points else 0.0
        peak = max((p.equity for p in points), default=0.0)

        return EquityCurveResponse(
            starting_equity=points[0].equity if points else 0.0,
            initial_deposit=deposit,
            current_equity=current_equity,
            peak_equity=peak,
            all_time_pnl=round(current_equity - deposit, 2) if deposit else None,
            roi_percent=round(((current_equity - deposit) / deposit) * 100.0, 2) if deposit else None,
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

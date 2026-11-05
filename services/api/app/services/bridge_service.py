"""Telemetry ingest and journal reads for a single MT5 connection.

Pipstride is strictly read-only: this module persists what the MT5 monitor
reports and never sends execution commands back to the terminal.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional

from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
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
from app.services.connection_service import (
    ConnectionBindingError,
    ConnectionTokenInvalidError,
    connection_service,
)

SNAPSHOT_MIN_INTERVAL_SECONDS = settings.SNAPSHOT_MIN_INTERVAL_SECONDS

# Fields the EA repeats on every poll but that the dashboard never reads from
# /status. Closed trades are served by /bridge/history and persisted in SQL,
# so echoing 100+ rows back on every poll is pure egress. Candles stay: the
# market chart reads them from the live payload.
HEAVY_PAYLOAD_KEYS = ("closed_trades",)

# Cap the number of closed trades replayed per ingest call. The EA already
# sends at most ~100 recent deals; anything larger is a client bug.
MAX_INGEST_TRADES = 2000

logger = logging.getLogger(__name__)


def _dedupe_trades(items: Iterable[ClosedTradeItem]) -> List[ClosedTradeItem]:
    """Keep one row per ticket.

    A position can produce several deals (entry + exit + partials) and retried
    batches can repeat tickets. Inserting duplicates would violate
    uq_trade_connection_ticket and abort the whole batch.
    """
    seen: set = set()
    unique: List[ClosedTradeItem] = []
    for item in items:
        if item.ticket in seen:
            continue
        seen.add(item.ticket)
        unique.append(item)
    return unique[:MAX_INGEST_TRADES]


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
            raise ConnectionTokenInvalidError("Invalid or revoked connection token.")

        # Skip duplicate-account conflict check when already bound (saves 1
        # SELECT per heartbeat for the common case).
        if connection.account_number is None or connection.account_number != payload.account_number:
            try:
                connection_service.bind_account(
                    db,
                    connection,
                    account_number=payload.account_number,
                    broker_server=payload.server,
                    currency=payload.currency,
                )
            except ConnectionBindingError:
                db.rollback()
                raise

        # Throttle last_seen writes: only flush to PG every N seconds. Live
        # freshness comes from the Redis captured_at timestamp, not this column.
        changed = False
        now = _now()
        last_seen = _as_utc(connection.last_seen_at)
        if last_seen is None or (now - last_seen).total_seconds() >= settings.LAST_SEEN_FLUSH_SECONDS:
            connection.last_seen_at = now
            changed = True
        if connection.status != "connected":
            connection.status = "connected"
            changed = True

        snapshot_added = self._persist_snapshot(db, connection, payload)
        trades_added = self._persist_trades(db, connection, payload)

        # Build a lean live payload: strip heavy keys that the dashboard reads
        # through dedicated endpoints.
        payload_data = payload.model_dump(mode="json")
        payload_data.pop("bridge_token", None)
        for key in HEAVY_PAYLOAD_KEYS:
            payload_data.pop(key, None)
        live_state.save_live_payload(
            connection.id,
            {
                "captured_at": int(time.time()),
                "payload": payload_data,
            },
        )

        # Only touch PostgreSQL when something actually changed. An idle
        # heartbeat is now a single SELECT for the token plus one Redis SET.
        # ``db.new``/``db.dirty`` cover writes made by bind_account() (first
        # bind, audit row) that the local flags do not track.
        try:
            if changed or snapshot_added or trades_added or db.new or db.dirty:
                db.commit()
            else:
                db.rollback()
        except IntegrityError:
            # A concurrent worker inserted the same trade ticket between our
            # dedupe SELECT and this commit. The live payload is already in
            # Redis, so drop the durable batch and let the next tick retry.
            db.rollback()
            live_state.clear_trade_count(connection.id)
            logger.warning("Heartbeat commit hit a duplicate trade ticket; deferred")

        # Refresh the cached count only when a batch actually inserted rows.
        # An idle heartbeat must not pay for COUNT(*).
        if trades_added:
            self._refresh_trade_count_cache(db, connection)

        return HeartbeatResponse(
            status="ok",
            server_time=int(time.time()),
            resync_trades=live_state.consume_trade_resync(connection.id),
        )

    def _persist_snapshot(self, db: Session, connection: Mt5Connection, payload: HeartbeatPayload) -> bool:
        # Use an index-only scan on captured_at instead of loading the full row.
        latest_at = db.scalar(
            select(TelemetrySnapshot.captured_at)
            .where(TelemetrySnapshot.connection_id == connection.id)
            .order_by(TelemetrySnapshot.captured_at.desc())
            .limit(1)
        )
        if latest_at is not None:
            age = (_now() - _as_utc(latest_at)).total_seconds()
            if age < SNAPSHOT_MIN_INTERVAL_SECONDS:
                return False

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
        return True

    def _existing_tickets(self, db: Session, connection_id: str, tickets: List[int]) -> set:
        """Fetch only the tickets present in this payload, chunked.

        The old implementation selected every ticket the connection had ever
        seen on every heartbeat.
        """
        existing: set = set()
        chunk = settings.TRADE_SYNC_CHUNK_SIZE
        for start in range(0, len(tickets), chunk):
            existing.update(
                db.scalars(
                    select(Trade.ticket).where(
                        Trade.connection_id == connection_id,
                        Trade.ticket.in_(tickets[start : start + chunk]),
                    )
                )
            )
        return existing

    @staticmethod
    def _trade_rows(connection_id: str, items: List[ClosedTradeItem]) -> List[Trade]:
        return [
            Trade(
                connection_id=connection_id,
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
            for item in items
        ]

    def _persist_trades(self, db: Session, connection: Mt5Connection, payload: HeartbeatPayload) -> bool:
        incoming = _dedupe_trades(payload.closed_trades or [])
        if not incoming:
            return False

        existing = self._existing_tickets(db, connection.id, [item.ticket for item in incoming])
        new_items = [item for item in incoming if item.ticket not in existing]
        if not new_items:
            return False
        db.bulk_save_objects(self._trade_rows(connection.id, new_items))
        return True

    # ------------------------------------------------------- trade sync path
    def sync_trades(
        self,
        db: Session,
        connection: Mt5Connection,
        closed_trades: List[ClosedTradeItem],
    ) -> dict:
        """Dedicated trade-sync endpoint handler (no heartbeat attached).

        The dashboard reads trades from ``trades``; the live payload no longer
        carries them. Idempotent: existing tickets are ignored, and a race with
        another worker is retried once instead of failing the whole batch.
        """
        incoming = _dedupe_trades(closed_trades or [])
        received = len(incoming)
        if not received:
            return {"status": "ok", "received": 0, "inserted": 0}

        for attempt in range(2):
            existing = self._existing_tickets(db, connection.id, [item.ticket for item in incoming])
            new_items = [item for item in incoming if item.ticket not in existing]
            if not new_items:
                return {"status": "ok", "received": received, "inserted": 0}
            try:
                db.bulk_save_objects(self._trade_rows(connection.id, new_items))
                db.commit()
                self._refresh_trade_count_cache(db, connection)
                return {"status": "ok", "received": received, "inserted": len(new_items)}
            except IntegrityError:
                # Lost a race against a concurrent insert for the same ticket.
                # Re-dedupe against committed rows and retry once.
                db.rollback()
                live_state.clear_trade_count(connection.id)
                if attempt == 1:
                    raise
        return {"status": "ok", "received": received, "inserted": 0}

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

    def _refresh_trade_count_cache(self, db: Session, connection: Mt5Connection) -> int:
        count = int(
            db.scalar(
                select(func.count(Trade.id)).where(Trade.connection_id == connection.id)
            )
            or 0
        )
        live_state.save_trade_count(connection.id, count)
        return count

    def _closed_trade_count(self, db: Session, connection: Mt5Connection) -> int:
        cached = live_state.load_trade_count(connection.id)
        if cached is not None:
            return cached
        return self._refresh_trade_count_cache(db, connection)

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
                open_time=_ts(row.opened_at) or 0,
                close_time=_ts(row.closed_at) or 0,
                magic=row.magic,
            )
            for row in rows
        ]

        net_pnl = round(gross_profit + gross_loss, 2)
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
        # Clear first: if the SET below fails, the cleared entry forces the
        # next status poll to re-count; a lone SET failure would otherwise
        # leave the pre-reset cached count visible for up to an hour.
        live_state.clear_trade_count(connection.id)
        live_state.save_trade_count(connection.id, 0)
        # The lean heartbeat no longer carries trades, so tell the EA to replay
        # its history on the next tick — otherwise the journal stays empty
        # until the next deal closes or the EA restarts.
        live_state.request_trade_resync(connection.id)
        return {
            "status": "success",
            "message": "Riwayat jurnal dihapus. Data akan tersinkron ulang dari MT5.",
            "account_number": connection.account_number,
        }


bridge_service = BridgeService()

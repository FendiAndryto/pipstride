"""Telemetry ingest for the read-only MT5 monitor.

Pipstride persists what the terminal reports and never sends execution
commands back. This module owns the write path: heartbeat persistence, the
event-driven trade sync, and the journal reset.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Iterable, List

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import live_state
from app.core.config import settings
from app.db.base import session_scope
from app.db.models import Mt5Connection
from app.domain.errors import ConnectionBindingError
from app.domain.time import as_utc
from app.infrastructure.db.repositories import telemetry_repository
from app.models.bridge import ClosedTradeItem, HeartbeatPayload, HeartbeatResponse
from app.services.connection_service import connection_service

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


class TelemetryIngestService:
    # ------------------------------------------------------------------ ingest
    def process_heartbeat(
        self,
        db: Session,
        connection: Mt5Connection,
        payload: HeartbeatPayload,
    ) -> HeartbeatResponse:
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
        last_seen = as_utc(connection.last_seen_at)
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
        # bind, audit row) that the local flags do not track. The transaction
        # is owned by session_scope, never by this service.
        try:
            if changed or snapshot_added or trades_added or db.new or db.dirty:
                with session_scope(db):
                    pass
            else:
                db.rollback()
        except IntegrityError:
            # A concurrent worker inserted the same trade ticket between our
            # dedupe SELECT and this commit. The live payload is already in
            # Redis, so drop the durable batch and let the next tick retry.
            live_state.clear_trade_count(connection.id)
            logger.warning("Heartbeat commit hit a duplicate trade ticket; deferred")

        # Refresh the cached count only when a batch actually inserted rows.
        # An idle heartbeat must not pay for COUNT(*).
        if trades_added:
            self.refresh_trade_count_cache(db, connection)

        return HeartbeatResponse(
            status="ok",
            server_time=int(time.time()),
            resync_trades=live_state.consume_trade_resync(connection.id),
        )

    def _persist_snapshot(self, db: Session, connection: Mt5Connection, payload: HeartbeatPayload) -> bool:
        # Index-only scan on captured_at instead of loading the full row.
        latest_at = telemetry_repository.latest_snapshot_at(db, connection.id)
        if latest_at is not None:
            age = (_now() - as_utc(latest_at)).total_seconds()
            if age < SNAPSHOT_MIN_INTERVAL_SECONDS:
                return False

        telemetry_repository.insert_snapshot(db, connection.id, payload)
        return True

    def _persist_trades(self, db: Session, connection: Mt5Connection, payload: HeartbeatPayload) -> bool:
        incoming = _dedupe_trades(payload.closed_trades or [])
        if not incoming:
            return False

        existing = telemetry_repository.existing_tickets(
            db,
            connection.id,
            [item.ticket for item in incoming],
            settings.TRADE_SYNC_CHUNK_SIZE,
        )
        new_items = [item for item in incoming if item.ticket not in existing]
        if not new_items:
            return False
        telemetry_repository.insert_trades(db, connection.id, new_items)
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
            existing = telemetry_repository.existing_tickets(
                db,
                connection.id,
                [item.ticket for item in incoming],
                settings.TRADE_SYNC_CHUNK_SIZE,
            )
            new_items = [item for item in incoming if item.ticket not in existing]
            if not new_items:
                return {"status": "ok", "received": received, "inserted": 0}
            try:
                with session_scope(db):
                    telemetry_repository.insert_trades(db, connection.id, new_items)
                self.refresh_trade_count_cache(db, connection)
                return {"status": "ok", "received": received, "inserted": len(new_items)}
            except IntegrityError:
                # Lost a race against a concurrent insert for the same ticket.
                # Re-dedupe against committed rows and retry once.
                live_state.clear_trade_count(connection.id)
                if attempt == 1:
                    raise
        return {"status": "ok", "received": received, "inserted": 0}

    # ------------------------------------------------------- trade count cache
    def refresh_trade_count_cache(self, db: Session, connection: Mt5Connection) -> int:
        count = telemetry_repository.count_trades(db, connection.id)
        live_state.save_trade_count(connection.id, count)
        return count

    def closed_trade_count(self, db: Session, connection: Mt5Connection) -> int:
        cached = live_state.load_trade_count(connection.id)
        if cached is not None:
            return cached
        return self.refresh_trade_count_cache(db, connection)

    # ------------------------------------------------------------------ reset
    def reset_journal(self, db: Session, connection: Mt5Connection) -> dict:
        with session_scope(db):
            telemetry_repository.delete_trades_and_snapshots(db, connection.id)
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


telemetry_ingest_service = TelemetryIngestService()

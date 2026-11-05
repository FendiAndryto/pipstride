"""Per-connection analytical settings.

The only settings today are the manual initial-deposit override and its
derived baseline. Nothing here touches a broker: these values only affect how
the journal measures P/L.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.core import live_state
from app.db.base import session_scope
from app.db.models import AccountSettings, Mt5Connection
from app.models.bridge import HeartbeatPayload


class AccountSettingsService:
    def has_override(self, db: Session, connection: Mt5Connection) -> bool:
        row = db.get(AccountSettings, connection.id)
        return bool(row and row.custom_initial_deposit and row.custom_initial_deposit > 0)

    def get_effective_initial_deposit(
        self, db: Session, connection: Mt5Connection
    ) -> Optional[float]:
        """Manual override, else the deposit the EA reported, else balance."""
        row = db.get(AccountSettings, connection.id)
        if row and row.custom_initial_deposit and row.custom_initial_deposit > 0:
            return float(row.custom_initial_deposit)

        live = live_state.load_live_payload(connection.id)
        if live:
            payload = HeartbeatPayload(**live["payload"])
            if payload.initial_deposit and payload.initial_deposit > 0:
                return float(payload.initial_deposit)
            if payload.balance > 0:
                return float(payload.balance)
        return None

    def set_initial_deposit_override(
        self, db: Session, connection: Mt5Connection, amount: Optional[float]
    ) -> Optional[float]:
        with session_scope(db):
            row = db.get(AccountSettings, connection.id)
            if row is None:
                row = AccountSettings(connection_id=connection.id)
                db.add(row)
            row.custom_initial_deposit = float(amount) if amount and amount > 0 else None

        return self.get_effective_initial_deposit(db, connection)


account_settings_service = AccountSettingsService()

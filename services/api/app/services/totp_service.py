"""Mandatory TOTP for privileged roles (ADR 0008 §5).

The seed is generated server-side, stored encrypted (``app.core.crypto``), and
revealed exactly once during enrollment. ``totp_enrolled_at`` is the switch that
unlocks login: a pending seed alone never authorises access.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import pyotp
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.db.base import session_scope
from app.db.models import User

ROLES_REQUIRING_TOTP = frozenset({"admin", "support"})
VALID_WINDOW = 1  # accept one 30-second step of clock drift in each direction


def _now() -> datetime:
    return datetime.now(timezone.utc)


def requires_totp(user: User) -> bool:
    return getattr(user, "role", "") in ROLES_REQUIRING_TOTP


class TotpService:
    def is_enrolled(self, user: User) -> bool:
        return user.totp_enrolled_at is not None and bool(user.totp_secret)

    def start_enrollment(self, db: Session, user: User) -> tuple[str, str]:
        """Create a new seed and return ``(secret, otpauth_uri)`` exactly once."""
        if self.is_enrolled(user):
            raise ValueError("TOTP is already enrolled for this account")

        secret = pyotp.random_base32()
        with session_scope(db):
            user.totp_secret = encrypt_secret(secret)
            user.totp_enrolled_at = None
        db.refresh(user)

        uri = pyotp.TOTP(secret).provisioning_uri(
            name=user.username, issuer_name=settings.TOTP_ISSUER
        )
        return secret, uri

    def verify_enrollment(self, db: Session, user: User, code: str) -> bool:
        if not user.totp_secret:
            return False
        try:
            secret = decrypt_secret(user.totp_secret)
        except ValueError:
            return False
        if not pyotp.TOTP(secret).verify(
            (code or "").strip(), valid_window=VALID_WINDOW
        ):
            return False

        with session_scope(db):
            user.totp_enrolled_at = _now()
        db.refresh(user)
        return True

    def verify_code(self, user: User, code: Optional[str]) -> bool:
        cleaned = (code or "").strip()
        if not cleaned or not user.totp_secret:
            return False
        try:
            secret = decrypt_secret(user.totp_secret)
        except ValueError:
            return False
        return pyotp.TOTP(secret).verify(cleaned, valid_window=VALID_WINDOW)


totp_service = TotpService()

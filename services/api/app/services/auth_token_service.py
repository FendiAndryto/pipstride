"""Single-use tokens backing password reset and email verification.

Only the SHA-256 digest is persisted; the raw value exists solely in the
emailed link. Issuing a new token for the same purpose burns any outstanding
one, and consumption is a conditional update so two concurrent requests cannot
both succeed.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.tokens import hash_token
from app.db.base import session_scope
from app.db.models import AuthToken, User
from app.domain.time import as_utc

PURPOSE_RESET = "reset_password"
PURPOSE_VERIFY = "verify_email"

TOKEN_BYTES = 32


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AuthTokenService:
    def issue(
        self, db: Session, user: User, purpose: str, ttl: timedelta
    ) -> str:
        """Create a token, invalidating older unused ones for the same purpose."""
        now = _now()
        raw = secrets.token_urlsafe(TOKEN_BYTES)
        with session_scope(db):
            db.execute(
                update(AuthToken)
                .where(
                    AuthToken.user_id == user.id,
                    AuthToken.purpose == purpose,
                    AuthToken.used_at.is_(None),
                )
                .values(used_at=now)
            )
            db.add(
                AuthToken(
                    user_id=user.id,
                    purpose=purpose,
                    token_hash=hash_token(raw),
                    expires_at=now + ttl,
                )
            )
        return raw

    def consume(self, db: Session, raw_token: str, purpose: str) -> Optional[User]:
        """Return the token owner and burn the token, or ``None`` if unusable.

        The caller owns the transaction: commit the resulting change (new
        password, verified address) together with the burn.
        """
        raw_token = (raw_token or "").strip()
        if not raw_token:
            return None

        row = db.scalar(
            select(AuthToken).where(
                AuthToken.token_hash == hash_token(raw_token),
                AuthToken.purpose == purpose,
            )
        )
        if row is None or row.used_at is not None:
            return None
        if as_utc(row.expires_at) <= _now():
            return None

        burned = db.execute(
            update(AuthToken)
            .where(AuthToken.id == row.id, AuthToken.used_at.is_(None))
            .values(used_at=_now())
        )
        if burned.rowcount != 1:
            return None

        return db.get(User, row.user_id)


auth_token_service = AuthTokenService()

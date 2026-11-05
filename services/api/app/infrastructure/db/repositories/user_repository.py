"""User lookups used by the auth dependency.

Kept deliberately small: the password policy and registration flow remain in
``user_service``; this module only answers "which row has this username?".
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import User


def get_by_username(db: Session, username: str) -> Optional[User]:
    cleaned = (username or "").strip()
    if not cleaned:
        return None
    return db.scalar(select(User).where(User.username == cleaned))

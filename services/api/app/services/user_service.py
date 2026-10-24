import re
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.db.models import Entitlement, User

USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]{3,32}$")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def validate_password_complexity(password: str) -> None:
    """At least 8 characters, containing letters and numbers."""
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long")
    if not re.search(r"[a-zA-Z]", password):
        raise ValueError("Password must contain at least one letter")
    if not re.search(r"[0-9]", password):
        raise ValueError("Password must contain at least one number")


def validate_username(username: str) -> str:
    cleaned = (username or "").strip()
    if not USERNAME_PATTERN.match(cleaned):
        raise ValueError(
            "Username must be 3-32 characters and contain only letters, numbers, dot, dash or underscore"
        )
    return cleaned


def normalize_email(email: Optional[str]) -> Optional[str]:
    """Lower-case and validate; ``None`` means "no email on file"."""
    if email is None:
        return None
    cleaned = email.strip().lower()
    if not cleaned:
        return None
    if len(cleaned) > 255 or not EMAIL_PATTERN.match(cleaned):
        raise ValueError("Enter a valid email address")
    return cleaned


class UserService:
    def get_user(self, db: Session, username: str) -> Optional[User]:
        cleaned = (username or "").strip()
        if not cleaned:
            return None
        return db.scalar(select(User).where(User.username == cleaned))

    def get_user_by_id(self, db: Session, user_id: str) -> Optional[User]:
        return db.get(User, user_id)

    def get_user_by_email(self, db: Session, email: str) -> Optional[User]:
        cleaned = normalize_email(email)
        if not cleaned:
            return None
        return db.scalar(select(User).where(User.email == cleaned))

    def authenticate(self, db: Session, username: str, plain_password: str) -> Optional[User]:
        user = self.get_user(db, username)
        if not user or not user.is_active:
            # Constant-time: always run bcrypt even when user is missing
            # to prevent username enumeration via response timing.
            hash_password("dummy-password-timing-pad")
            return None
        if verify_password(plain_password, user.password_hash):
            return user
        return None

    def register(
        self,
        db: Session,
        username: str,
        plain_password: str,
        role: str = "trader",
        email: Optional[str] = None,
    ) -> User:
        cleaned = validate_username(username)
        validate_password_complexity(plain_password)
        normalized_email = normalize_email(email)

        if self.get_user(db, cleaned):
            raise ValueError("Username already registered")
        if normalized_email and self.get_user_by_email(db, normalized_email):
            raise ValueError("Email already registered")

        user = User(
            username=cleaned,
            email=normalized_email,
            password_hash=hash_password(plain_password),
            role=role,
        )
        db.add(user)
        db.flush()

        db.add(Entitlement(user_id=user.id, plan_code="free", max_connections=1))
        db.commit()
        db.refresh(user)
        return user

    def set_email(self, db: Session, user: User, email: str) -> User:
        normalized = normalize_email(email)
        if not normalized:
            raise ValueError("Enter a valid email address")

        existing = self.get_user_by_email(db, normalized)
        if existing is not None and existing.id != user.id:
            raise ValueError("Email already registered")

        user.email = normalized
        user.email_verified_at = None
        db.commit()
        db.refresh(user)
        return user

    def mark_email_verified(self, db: Session, user: User) -> User:
        user.email_verified_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(user)
        return user

    def reset_password(self, db: Session, user: User, new_password: str) -> User:
        validate_password_complexity(new_password)
        user.password_hash = hash_password(new_password)
        # A reset must also sign out every existing session.
        user.token_version = int(user.token_version) + 1
        db.commit()
        db.refresh(user)
        return user

    def change_password(self, db: Session, user: User, old_password: str, new_password: str) -> bool:
        if not verify_password(old_password, user.password_hash):
            return False

        validate_password_complexity(new_password)
        user.password_hash = hash_password(new_password)
        user.token_version = int(user.token_version) + 1
        db.commit()
        return True

    def increment_token_version(self, db: Session, user: User) -> int:
        user.token_version = int(user.token_version) + 1
        db.commit()
        return user.token_version


user_service = UserService()

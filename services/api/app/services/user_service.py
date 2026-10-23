import time
import re
import logging
from typing import Dict, Optional, Any
from app.core.security import hash_password, verify_password
from app.db.database import get_db_connection, init_db, generate_bridge_token

logger = logging.getLogger(__name__)


def validate_password_complexity(password: str) -> None:
    """Enforce security policy: at least 8 chars, containing letters and numbers."""
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long")
    if not re.search(r"[a-zA-Z]", password):
        raise ValueError("Password must contain at least one letter")
    if not re.search(r"[0-9]", password):
        raise ValueError("Password must contain at least one number")


class UserService:
    def __init__(self):
        init_db()

    def get_user(self, username: str) -> Optional[Dict[str, Any]]:
        cleaned = username.strip()
        if not cleaned:
            return None
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM users WHERE username = ?", (cleaned,))
            row = cursor.fetchone()
            if row:
                return dict(row)
        return None

    def get_user_by_bridge_token(self, token: str) -> Optional[Dict[str, Any]]:
        cleaned = token.strip()
        if not cleaned:
            return None
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM users WHERE bridge_token = ? AND is_active = 1", (cleaned,))
            row = cursor.fetchone()
            if row:
                return dict(row)
        return None

    def authenticate(self, username: str, plain_password: str) -> Optional[Dict[str, Any]]:
        user = self.get_user(username)
        if not user or not user.get("is_active", 1):
            return None

        stored_hash = user.get("password_hash", "")
        if verify_password(plain_password, stored_hash):
            return user
        return None

    def register(self, username: str, plain_password: str, role: str = "trader") -> Dict[str, Any]:
        cleaned_username = username.strip()
        if not cleaned_username:
            raise ValueError("Username cannot be empty")

        validate_password_complexity(plain_password)

        if self.get_user(cleaned_username):
            raise ValueError("Username already registered")

        bridge_token = generate_bridge_token()
        now = int(time.time())

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO users (username, password_hash, role, bridge_token, token_version, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, 1, 1, ?, ?)
                """,
                (cleaned_username, hash_password(plain_password), role, bridge_token, now, now)
            )
            user_id = cursor.lastrowid
            conn.commit()

        return {
            "id": user_id,
            "username": cleaned_username,
            "role": role,
            "bridge_token": bridge_token,
            "token_version": 1,
            "is_active": 1,
            "created_at": now,
            "updated_at": now
        }

    def change_password(self, username: str, old_password: str, new_password: str) -> bool:
        user = self.authenticate(username, old_password)
        if not user:
            return False

        validate_password_complexity(new_password)

        now = int(time.time())
        new_version = int(user.get("token_version", 1)) + 1

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE users
                SET password_hash = ?, token_version = ?, updated_at = ?
                WHERE username = ?
                """,
                (hash_password(new_password), new_version, now, user["username"])
            )
            conn.commit()
            return cursor.rowcount > 0

    def increment_token_version(self, username: str) -> int:
        """Increment token_version to invalidate all existing JWT tokens (logout)."""
        user = self.get_user(username)
        if not user:
            return 1

        now = int(time.time())
        new_version = int(user.get("token_version", 1)) + 1

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE users
                SET token_version = ?, updated_at = ?
                WHERE username = ?
                """,
                (new_version, now, user["username"])
            )
            conn.commit()

        return new_version

    def regenerate_bridge_token(self, username: str) -> str:
        """Generate a new bridge token for the user, invalidating the previous one."""
        user = self.get_user(username)
        if not user:
            raise ValueError(f"User '{username}' not found")

        new_token = generate_bridge_token()
        now = int(time.time())

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE users
                SET bridge_token = ?, updated_at = ?
                WHERE username = ?
                """,
                (new_token, now, user["username"])
            )
            conn.commit()

        return new_token

    def get_custom_initial_deposit(self, username: str) -> Optional[float]:
        user = self.get_user(username)
        if not user:
            return None
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT custom_initial_deposit FROM account_settings WHERE user_id = ?",
                (user["id"],)
            )
            row = cursor.fetchone()
            if row and row["custom_initial_deposit"] is not None:
                return float(row["custom_initial_deposit"])
        return None

    def set_custom_initial_deposit(self, username: str, amount: Optional[float]):
        user = self.get_user(username)
        if not user:
            return
        now = int(time.time())
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO account_settings (user_id, custom_initial_deposit, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    custom_initial_deposit = excluded.custom_initial_deposit,
                    updated_at = excluded.updated_at
                """,
                (user["id"], float(amount) if amount is not None else None, now)
            )
    def deactivate_user(self, username: str):
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE users SET is_active = 0 WHERE username = ?", (username.strip(),))
            conn.commit()


user_service = UserService()

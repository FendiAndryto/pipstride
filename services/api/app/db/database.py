import os
import json
import time
import secrets
import sqlite3
import logging
from typing import Optional, Dict, Any, List
from app.core.config import settings
from app.core.security import hash_password

logger = logging.getLogger(__name__)

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_FILE = os.path.join(DB_DIR, "pipstride.db")


def generate_bridge_token() -> str:
    """Generate a secure, high-entropy bridge token."""
    return f"pst_live_{secrets.token_hex(16)}"


def get_db_connection() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_FILE, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db():
    """Initialize database tables and run migration if needed."""
    os.makedirs(DB_DIR, exist_ok=True)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'trader',
                bridge_token TEXT UNIQUE NOT NULL,
                token_version INTEGER NOT NULL DEFAULT 1,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_users_bridge_token ON users(bridge_token);
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS account_settings (
                user_id INTEGER PRIMARY KEY,
                custom_initial_deposit REAL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        conn.commit()

    _seed_default_admin()


def _seed_default_admin():
    """Ensure default admin account exists in database."""
    admin_user = settings.ADMIN_USERNAME.strip()
    admin_pass = settings.ADMIN_PASSWORD
    now = int(time.time())

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE username = ?", (admin_user,))
        if not cursor.fetchone():
            cursor.execute(
                """
                INSERT INTO users (username, password_hash, role, bridge_token, token_version, is_active, created_at, updated_at)
                VALUES (?, ?, 'admin', ?, 1, 1, ?, ?)
                """,
                (admin_user, hash_password(admin_pass), generate_bridge_token(), now, now)
            )
            conn.commit()
            logger.info(f"Seeded default admin user '{admin_user}' in SQLite database.")

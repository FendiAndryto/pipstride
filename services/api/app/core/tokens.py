import hashlib
import hmac
import secrets

TOKEN_PREFIX = "pst_live_"
TOKEN_BYTES = 32
DISPLAY_PREFIX_LENGTH = len(TOKEN_PREFIX) + 4


def generate_token() -> str:
    """Create a new high-entropy connection token for an MT5 binding."""
    return f"{TOKEN_PREFIX}{secrets.token_hex(TOKEN_BYTES)}"


def hash_token(raw_token: str) -> str:
    """Digest used for storage and lookup; raw tokens are never persisted."""
    return hashlib.sha256(raw_token.strip().encode("utf-8")).hexdigest()


def token_display_prefix(raw_token: str) -> str:
    """Short, non-sensitive prefix shown in the dashboard."""
    return raw_token[:DISPLAY_PREFIX_LENGTH]


def verify_token(raw_token: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_token(raw_token), stored_hash)

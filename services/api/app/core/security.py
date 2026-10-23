import hmac
import time
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, Tuple
import jwt
import bcrypt
from app.core.config import settings


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, stored_password: str) -> bool:
    if not stored_password:
        return False
        
    # Check if stored password is a bcrypt hash
    if stored_password.startswith(("$2a$", "$2b$", "$2y$")):
        try:
            return bcrypt.checkpw(
                plain_password.encode("utf-8"),
                stored_password.encode("utf-8")
            )
        except Exception:
            return False
            
    # Otherwise fallback to constant-time string comparison (e.g. plain text password from .env)
    return hmac.compare_digest(plain_password, stored_password)


def create_access_token(
    subject: str,
    token_version: int = 1,
    expires_delta: Optional[timedelta] = None
) -> str:
    if expires_delta is not None:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        
    payload: Dict[str, Any] = {
        "sub": subject,
        "ver": token_version,
        "exp": int(expire.timestamp()),
        "iat": int(datetime.now(timezone.utc).timestamp()),
    }
    
    return jwt.encode(
        payload,
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM
    )


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except (jwt.PyJWTError, Exception):
        return None


class LoginRateLimiter:
    """Thread-safe sliding window rate limiter for login and registration attempts."""
    def __init__(self, max_attempts: int = 5, window_seconds: int = 300):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        self._failures: Dict[str, list] = {}

    def is_rate_limited(self, key: str) -> Tuple[bool, int]:
        now = time.time()
        with self._lock:
            attempts = self._failures.get(key, [])
            valid_attempts = [t for t in attempts if now - t < self.window_seconds]
            self._failures[key] = valid_attempts
            
            if len(valid_attempts) >= self.max_attempts:
                oldest = valid_attempts[0]
                retry_after = int(self.window_seconds - (now - oldest)) + 1
                return True, max(1, retry_after)
            return False, 0

    def record_failure(self, key: str):
        now = time.time()
        with self._lock:
            attempts = self._failures.get(key, [])
            attempts.append(now)
            self._failures[key] = [t for t in attempts if now - t < self.window_seconds]

    def record_success(self, key: str):
        with self._lock:
            if key in self._failures:
                del self._failures[key]

    def reset(self):
        with self._lock:
            self._failures.clear()


rate_limiter = LoginRateLimiter()

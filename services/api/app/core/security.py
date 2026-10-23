import hmac
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

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

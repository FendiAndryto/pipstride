from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.base import get_db
from app.db.models import Mt5Connection, User
from app.domain.time import as_utc
from app.infrastructure.db.repositories import connection_repository, user_repository

security_bearer = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise _unauthorized("Authentication token required")

    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise _unauthorized("Invalid or expired session token")

    username: Optional[str] = payload.get("sub")
    token_ver: Optional[int] = payload.get("ver")
    if not username:
        raise _unauthorized("User not recognized or invalid session")

    user = user_repository.get_by_username(db, username)
    if not user or not user.is_active:
        raise _unauthorized("User not recognized or account deactivated")

    if user.expires_at is not None and as_utc(user.expires_at) <= datetime.now(timezone.utc):
        raise _unauthorized("Session expired: account has expired. Please contact support to renew.")

    if token_ver is None or int(token_ver) != int(user.token_version):
        raise _unauthorized("Session has been revoked or expired. Please log in again.")

    return user


def require_role(*roles: str):
    """Dependency factory enforcing ``User.role`` membership.

    ``get_current_user`` already re-reads ``role``, ``is_active`` and
    ``token_version`` from the database on every request, so a demotion or
    deactivation takes effect immediately instead of waiting out the 24-hour
    JWT (ADR 0008 §3). This factory is mounted per admin router, and
    ``tests/test_admin_guard.py`` fails CI when a router forgets it.
    """
    allowed = frozenset(roles)

    def _guard(user: User = Depends(get_current_user)) -> User:
        if getattr(user, "role", "") not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient privileges for this endpoint.",
            )
        return user

    return _guard


require_admin = require_role("admin")


def get_active_connection(
    x_connection_id: Optional[str] = Header(None, alias="X-Connection-Id"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Mt5Connection:
    """Resolve the MT5 connection a request operates on.

    The dashboard switches accounts by sending ``X-Connection-Id``. When the
    header is absent we fall back to the user's oldest active connection, which
    keeps single-account clients working unchanged.
    """
    if x_connection_id:
        connection = connection_repository.get_active(db, user.id, x_connection_id)
        if connection is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="MT5 connection not found or revoked.",
            )
        return connection

    connections = connection_repository.list_active(db, user.id)
    if not connections:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No MT5 connection yet. Create one in the dashboard first.",
        )
    return connections[0]

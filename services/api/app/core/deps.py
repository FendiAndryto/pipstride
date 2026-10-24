from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.base import get_db
from app.db.models import Mt5Connection, User
from app.services.connection_service import connection_service
from app.services.user_service import user_service

security_bearer = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
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

    user = user_service.get_user(db, username)
    if not user or not user.is_active:
        raise _unauthorized("User not recognized or account deactivated")

    if token_ver is None or int(token_ver) != int(user.token_version):
        raise _unauthorized("Session has been revoked or expired. Please log in again.")

    return user


async def get_active_connection(
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
        connection = connection_service.get_connection(db, user.id, x_connection_id)
        if connection is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="MT5 connection not found or revoked.",
            )
        return connection

    connections = connection_service.list_connections(db, user.id)
    if not connections:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No MT5 connection yet. Create one in the dashboard first.",
        )
    return connections[0]

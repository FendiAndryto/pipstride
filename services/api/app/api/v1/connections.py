from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.models.auth import ConnectionCreatedResponse, ConnectionResponse
from app.services.connection_service import (
    ConnectionLimitReached,
    connection_service,
)

router = APIRouter(prefix="/connections", tags=["MT5 Connections"])


def _project(connection) -> dict:
    return {
        "id": connection.id,
        "label": connection.label,
        "token_prefix": connection.token_prefix,
        "status": connection.status,
        "account_number": connection.account_number,
        "broker_server": connection.broker_server,
        "account_currency": connection.account_currency,
        "last_seen_at": connection.last_seen_at.isoformat() if connection.last_seen_at else None,
        "created_at": connection.created_at.isoformat(),
    }


@router.get(
    "",
    response_model=List[ConnectionResponse],
    summary="List MT5 connections owned by the current user",
)
async def list_connections(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [_project(c) for c in connection_service.list_connections(db, user.id)]


@router.post(
    "",
    response_model=ConnectionCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new MT5 connection and return its token once",
)
async def create_connection(
    label: str = "Akun MT5",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        connection, raw_token = connection_service.create_connection(db, user, label=label)
    except ConnectionLimitReached as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    return {**_project(connection), "token": raw_token}


@router.post(
    "/{connection_id}/rotate",
    response_model=ConnectionCreatedResponse,
    summary="Rotate the token of a connection and rebind it on next connect",
)
async def rotate_token(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    connection = connection_service.get_connection(db, user.id, connection_id)
    if connection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    connection, raw_token = connection_service.rotate_token(db, user, connection)
    return {**_project(connection), "token": raw_token}


@router.delete(
    "/{connection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke a connection; its token stops working immediately",
)
async def revoke_connection(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    connection = connection_service.get_connection(db, user.id, connection_id)
    if connection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    connection_service.revoke_connection(db, user, connection)
    return None

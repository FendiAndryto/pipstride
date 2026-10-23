import time
from typing import List, Optional
from fastapi import APIRouter, Depends, Header, HTTPException, status
from app.models.bridge import (
    HeartbeatPayload,
    HeartbeatResponse,
    BridgeStatusResponse,
    PositionItem,
    MarketQuoteItem,
    TradeHistoryResponse,
    EquityCurveResponse,
    InitialDepositRequest,
    InitialDepositResponse,
)
from app.services.bridge_service import bridge_service
from app.core.deps import get_current_user

router = APIRouter(prefix="/bridge", tags=["Bridge"])


@router.post(
    "/heartbeat",
    response_model=HeartbeatResponse,
    status_code=status.HTTP_200_OK,
    summary="Receive periodic heartbeat telemetry from MT5 Bridge EA"
)
async def receive_heartbeat(
    payload: HeartbeatPayload,
    x_bridge_token: Optional[str] = Header(None, alias="X-Bridge-Token")
):
    token = x_bridge_token or payload.bridge_token
    return bridge_service.process_heartbeat(payload, bridge_token=token)


@router.get(
    "/status",
    response_model=BridgeStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve current MT5 bridge connectivity status and latest metrics for current user"
)
async def get_bridge_status(current_user: str = Depends(get_current_user)):
    return bridge_service.get_status(username=current_user)


@router.get(
    "/initial-deposit",
    response_model=InitialDepositResponse,
    status_code=status.HTTP_200_OK,
    summary="Get initial deposit baseline settings and all-time P/L return for current user"
)
async def get_initial_deposit(current_user: str = Depends(get_current_user)):
    return bridge_service.get_initial_deposit_info(username=current_user)


@router.post(
    "/initial-deposit",
    response_model=InitialDepositResponse,
    status_code=status.HTTP_200_OK,
    summary="Set or override manual initial deposit baseline for current user"
)
async def set_initial_deposit(
    req: InitialDepositRequest,
    current_user: str = Depends(get_current_user)
):
    return bridge_service.set_initial_deposit_override(req.initial_deposit, username=current_user)


@router.get(
    "/history",
    response_model=TradeHistoryResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve real closed deals history and calculated metrics directly from user's MT5"
)
async def get_trade_history(current_user: str = Depends(get_current_user)):
    return bridge_service.get_trade_history(username=current_user)


@router.post(
    "/history/reset",
    status_code=status.HTTP_200_OK,
    summary="Reset cached journal trade history and force resync with active MT5 account"
)
async def reset_trade_history(current_user: str = Depends(get_current_user)):
    return bridge_service.reset_trade_history(username=current_user)


@router.get(
    "/market",
    response_model=List[MarketQuoteItem],
    status_code=status.HTTP_200_OK,
    summary="Retrieve live quotes for monitored instruments from user's MT5 feed"
)
async def get_market_quotes(current_user: str = Depends(get_current_user)):
    return bridge_service.get_market_quotes(username=current_user)


@router.get(
    "/equity-curve",
    response_model=EquityCurveResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve equity snapshots over time for dynamic performance chart for current user"
)
async def get_equity_curve(
    range: str = "1M",
    current_user: str = Depends(get_current_user)
):
    return bridge_service.get_equity_curve(time_range=range, username=current_user)


@router.post(
    "/order",
    status_code=status.HTTP_403_FORBIDDEN,
    summary="Order execution disabled (Pure Read-Only Journal)"
)
async def submit_order():
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Pipstride is a 100% Pure Read-Only Journal platform. Trade execution and liquidations are disabled."
    )


@router.get(
    "/positions",
    response_model=List[PositionItem],
    status_code=status.HTTP_200_OK,
    summary="Retrieve currently open trading positions from user's MT5"
)
async def get_positions(current_user: str = Depends(get_current_user)):
    return bridge_service.get_positions(username=current_user)


@router.get(
    "/ping",
    summary="Simple ping-pong health check"
)
async def ping():
    return {
        "status": "pong",
        "timestamp": int(time.time())
    }

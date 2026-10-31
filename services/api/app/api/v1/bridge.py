import time
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_active_connection
from app.core.rate_limit import consume
from app.core.tokens import hash_token
from app.db.base import get_db
from app.db.models import Mt5Connection, User
from app.models.bridge import (
    BridgeStatusResponse,
    EquityCurveResponse,
    HeartbeatPayload,
    HeartbeatResponse,
    InitialDepositRequest,
    InitialDepositResponse,
    MarketQuoteItem,
    PositionItem,
    TradeHistoryResponse,
)
from app.models.risk import RiskWatchdogStatusResponse
from app.services.bridge_service import bridge_service

router = APIRouter(prefix="/bridge", tags=["Bridge"])


@router.post(
    "/heartbeat",
    response_model=HeartbeatResponse,
    status_code=status.HTTP_200_OK,
    summary="Receive periodic telemetry from the read-only MT5 monitor",
)
def receive_heartbeat(
    payload: HeartbeatPayload,
    response: Response,
    x_bridge_token: Optional[str] = Header(None, alias="X-Bridge-Token"),
    db: Session = Depends(get_db),
):
    token = x_bridge_token or payload.bridge_token

    # A misconfigured terminal can push far faster than the 1s cadence. Limit
    # per token so one runaway EA cannot starve the API for everyone else.
    if token:
        limited, retry_after = consume(
            f"hb:{hash_token(token)}",
            limit=settings.HEARTBEAT_RATE_LIMIT,
            window_seconds=settings.HEARTBEAT_RATE_WINDOW_SECONDS,
        )
        if limited:
            response.headers["Retry-After"] = str(retry_after)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Heartbeat rate limit exceeded; slow down the monitor interval.",
                headers={"Retry-After": str(retry_after)},
            )

    return bridge_service.process_heartbeat(db, payload, raw_token=token)


@router.get(
    "/status",
    response_model=BridgeStatusResponse,
    summary="Current bridge connectivity and latest metrics for the active connection",
)
def get_bridge_status(
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    return bridge_service.get_status(db, connection)


@router.get("/positions", response_model=List[PositionItem])
def get_positions(connection: Mt5Connection = Depends(get_active_connection)):
    return bridge_service.get_positions(connection)


@router.get("/market", response_model=List[MarketQuoteItem])
def get_market_quotes(connection: Mt5Connection = Depends(get_active_connection)):
    return bridge_service.get_market_quotes(connection)


@router.get("/history", response_model=TradeHistoryResponse)
def get_trade_history(
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    return bridge_service.get_trade_history(db, connection)


@router.post("/history/reset")
def reset_trade_history(
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    return bridge_service.reset_journal(db, connection)


@router.get("/equity-curve", response_model=EquityCurveResponse)
def get_equity_curve(
    range: str = "1M",
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    return bridge_service.get_equity_curve(db, connection, time_range=range)


@router.get("/initial-deposit", response_model=InitialDepositResponse)
def get_initial_deposit(
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    return bridge_service.get_initial_deposit_info(db, connection)


@router.post("/initial-deposit", response_model=InitialDepositResponse)
def set_initial_deposit(
    req: InitialDepositRequest,
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    return bridge_service.set_initial_deposit_override(db, connection, req.initial_deposit)


@router.get("/risk", response_model=RiskWatchdogStatusResponse, tags=["Risk Watchdog"])
def get_risk_watchdog(
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    from app.core.config import settings

    status_response = bridge_service.get_status(db, connection)
    drawdown = 0.0
    if status_response.initial_deposit and status_response.metrics:
        drawdown = max(
            0.0,
            ((status_response.initial_deposit - status_response.metrics.equity)
             / status_response.initial_deposit) * 100.0,
        )

    return RiskWatchdogStatusResponse(
        is_alert_active=drawdown >= settings.MAX_DAILY_DRAWDOWN_PERCENT,
        alert_reason=(
            f"Equity drawdown {drawdown:.2f}% melampaui batas "
            f"{settings.MAX_DAILY_DRAWDOWN_PERCENT}%"
            if drawdown >= settings.MAX_DAILY_DRAWDOWN_PERCENT
            else None
        ),
        alert_time=int(time.time()) if drawdown >= settings.MAX_DAILY_DRAWDOWN_PERCENT else None,
        daily_drawdown_percent=round(drawdown, 2),
        max_daily_drawdown_percent=settings.MAX_DAILY_DRAWDOWN_PERCENT,
        margin_level=status_response.metrics.margin_level if status_response.metrics else 0.0,
        max_spread_points=settings.MAX_SPREAD_POINTS,
        default_risk_percent=settings.DEFAULT_RISK_PER_TRADE_PERCENT,
        max_risk_percent=settings.MAX_RISK_PER_TRADE_PERCENT,
        min_lot=settings.MIN_LOT_SIZE,
        max_lot=settings.MAX_LOT_SIZE,
    )


@router.post(
    "/order",
    status_code=status.HTTP_403_FORBIDDEN,
    summary="Order execution disabled (Pure Read-Only Journal)",
)
async def submit_order():
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Pipstride is a 100% Pure Read-Only Journal platform. "
        "Trade execution and liquidations are disabled.",
    )


@router.get("/ping")
async def ping():
    return {"status": "pong", "timestamp": int(time.time())}

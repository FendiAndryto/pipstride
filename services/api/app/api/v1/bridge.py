import time
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_active_connection
from app.core.rate_limit import consume, get_client_ip
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
    SyncTradesRequest,
    TradeHistoryResponse,
)
from app.models.risk import RiskWatchdogStatusResponse
from app.domain.errors import ConnectionBindingError
from app.domain.policies import evaluate_drawdown, evaluate_overall_drawdown, is_account_active
from app.domain.time import to_unix
from app.services.account_settings_service import account_settings_service
from app.services.bridge_status_service import bridge_status_service
from app.services.connection_service import connection_service
from app.services.telemetry_ingest_service import telemetry_ingest_service

router = APIRouter(prefix="/bridge", tags=["Bridge"])


def _check_connection_owner_active(connection: Mt5Connection) -> None:
    if not is_account_active(connection.user.is_active, connection.user.expires_at):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive or has expired.",
        )


@router.post(
    "/heartbeat",
    response_model=HeartbeatResponse,
    status_code=status.HTTP_200_OK,
    summary="Receive periodic telemetry from the read-only MT5 monitor",
)
def receive_heartbeat(
    payload: HeartbeatPayload,
    request: Request,
    response: Response,
    x_bridge_token: Optional[str] = Header(None, alias="X-Bridge-Token"),
    db: Session = Depends(get_db),
):
    token = x_bridge_token or payload.bridge_token
    client_ip = get_client_ip(request)

    # General IP-level throttle against volumetric flood attacks (e.g. rotating fake tokens)
    ip_limited, ip_retry_after = consume(
        f"hb_ip:{client_ip}",
        limit=settings.HEARTBEAT_RATE_LIMIT * 2,
        window_seconds=settings.HEARTBEAT_RATE_WINDOW_SECONDS,
    )
    if ip_limited:
        response.headers["Retry-After"] = str(ip_retry_after)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Heartbeat rate limit exceeded for this IP.",
            headers={"Retry-After": str(ip_retry_after)},
        )

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
    else:
        # Tightly limit unauthenticated requests to mitigate DB connection exhaustion
        anon_limited, anon_retry = consume(f"hb_anon:{client_ip}", limit=10, window_seconds=10)
        if anon_limited:
            response.headers["Retry-After"] = str(anon_retry)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Unauthenticated heartbeat rate limit exceeded.",
                headers={"Retry-After": str(anon_retry)},
            )

    connection = connection_service.get_by_token(db, token or "")
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked connection token.",
        )
    _check_connection_owner_active(connection)

    try:
        return telemetry_ingest_service.process_heartbeat(db, connection, payload)
    except ConnectionBindingError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc


@router.post(
    "/sync-trades",
    summary="Push closed trades on deal events (lean heartbeats carry none)",
)
def sync_trades(
    payload: SyncTradesRequest,
    request: Request,
    response: Response,
    x_bridge_token: Optional[str] = Header(None, alias="X-Bridge-Token"),
    db: Session = Depends(get_db),
):
    token = x_bridge_token
    client_ip = get_client_ip(request)

    if not token:
        # Tightly limit unauthenticated sync attempts by IP before hitting DB
        anon_limited, anon_retry = consume(f"sync_anon:{client_ip}", limit=10, window_seconds=10)
        if anon_limited:
            response.headers["Retry-After"] = str(anon_retry)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Sync trades rate limit exceeded.",
                headers={"Retry-After": str(anon_retry)},
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bridge token is required.",
        )

    # General IP-level throttle
    ip_limited, ip_retry_after = consume(
        f"sync_ip:{client_ip}",
        limit=settings.HEARTBEAT_RATE_LIMIT * 2,
        window_seconds=settings.HEARTBEAT_RATE_WINDOW_SECONDS,
    )
    if ip_limited:
        response.headers["Retry-After"] = str(ip_retry_after)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trade sync rate limit exceeded for this IP.",
            headers={"Retry-After": str(ip_retry_after)},
        )

    limited, retry_after = consume(
        f"hb:{hash_token(token)}",
        limit=settings.HEARTBEAT_RATE_LIMIT,
        window_seconds=settings.HEARTBEAT_RATE_WINDOW_SECONDS,
    )
    if limited:
        response.headers["Retry-After"] = str(retry_after)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trade sync rate limit exceeded.",
            headers={"Retry-After": str(retry_after)},
        )

    connection = connection_service.get_by_token(db, token or "")
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked connection token.",
        )
    _check_connection_owner_active(connection)
    if payload.account_number is not None and connection.account_number is not None:
        if payload.account_number != connection.account_number:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Sync payload belongs to a different MT5 account.",
            )
    return telemetry_ingest_service.sync_trades(db, connection, payload.closed_trades)


@router.get(
    "/status",
    response_model=BridgeStatusResponse,
    summary="Current bridge connectivity and latest metrics for the active connection",
)
def get_bridge_status(
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    return bridge_status_service.get_status(db, connection)


@router.get("/positions", response_model=List[PositionItem])
def get_positions(connection: Mt5Connection = Depends(get_active_connection)):
    return bridge_status_service.get_positions(connection)


@router.get("/market", response_model=List[MarketQuoteItem])
def get_market_quotes(connection: Mt5Connection = Depends(get_active_connection)):
    return bridge_status_service.get_market_quotes(connection)


@router.get("/history", response_model=TradeHistoryResponse)
def get_trade_history(
    limit: int = 1000,
    offset: int = 0,
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    return bridge_status_service.get_trade_history(db, connection, limit=limit, offset=offset)


@router.post("/history/reset")
def reset_trade_history(
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    return telemetry_ingest_service.reset_journal(db, connection)


@router.get("/equity-curve", response_model=EquityCurveResponse)
def get_equity_curve(
    range: str = "1M",
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    return bridge_status_service.get_equity_curve(db, connection, time_range=range)


@router.get("/initial-deposit", response_model=InitialDepositResponse)
def get_initial_deposit(
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    return bridge_status_service.get_initial_deposit_info(db, connection)


@router.post("/initial-deposit", response_model=InitialDepositResponse)
def set_initial_deposit(
    req: InitialDepositRequest,
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    account_settings_service.set_initial_deposit_override(db, connection, req.initial_deposit)
    return bridge_status_service.get_initial_deposit_info(db, connection)


@router.get("/risk", response_model=RiskWatchdogStatusResponse, tags=["Risk Watchdog"])
def get_risk_watchdog(
    connection: Mt5Connection = Depends(get_active_connection),
    db: Session = Depends(get_db),
):
    """Passive drawdown report: broker-day daily + peak-to-trough overall.

    The route only assembles the response; the anchor reconstruction and the
    policy live in the service and ``app.domain`` respectively (ADR 0009).
    """
    status_response = bridge_status_service.get_status(db, connection)
    metrics = status_response.metrics
    deposit = status_response.initial_deposit

    anchor = bridge_status_service.get_daily_anchor(db, connection, metrics, deposit)
    boundary = anchor["at"]
    daily_trough = bridge_status_service.get_daily_trough(db, connection, boundary)

    daily = evaluate_drawdown(
        anchor["equity"],
        metrics.equity if metrics else None,
        daily_trough,
        settings.MAX_DAILY_DRAWDOWN_PERCENT,
    )

    overall_source = bridge_status_service.get_overall_drawdown(
        db,
        connection,
        metrics.equity if metrics else None,
        deposit,
    )
    overall = evaluate_overall_drawdown(
        overall_source["peak_equity"],
        overall_source["current_equity"],
        overall_source["trough_equity"],
        settings.MAX_OVERALL_DRAWDOWN_PERCENT,
    )

    daily_realized = None
    if anchor["balance"] is not None and metrics is not None:
        daily_realized = round(float(metrics.balance) - float(anchor["balance"]), 2)

    # Without a live equity and without any anchor equity there is no basis to
    # measure from; the zeros below are placeholders, not a clean bill of health.
    data_available = metrics is not None or anchor["equity"] is not None

    return RiskWatchdogStatusResponse(
        is_data_available=data_available,
        is_alert_active=daily.is_alert_active,
        alert_reason=(
            f"Daily drawdown {daily.max_pct:.2f}% exceeded the "
            f"{settings.MAX_DAILY_DRAWDOWN_PERCENT}% limit"
            if daily.reason_code
            else None
        ),
        alert_time=int(time.time()) if daily.is_alert_active else None,
        daily_drawdown_percent=daily.current_pct,
        daily_max_drawdown_percent=daily.max_pct,
        daily_realized_pnl=daily_realized,
        daily_starting_balance=anchor["balance"],
        daily_starting_equity=anchor["equity"],
        daily_anchor_at=to_unix(boundary),
        daily_anchor_source=anchor["source"],
        max_daily_drawdown_percent=settings.MAX_DAILY_DRAWDOWN_PERCENT,
        overall_drawdown_percent=overall.current_pct,
        max_drawdown_percent=overall.max_pct,
        peak_equity=overall_source["peak_equity"],
        peak_equity_at=overall_source["peak_equity_at"],
        max_overall_drawdown_percent=settings.MAX_OVERALL_DRAWDOWN_PERCENT,
        is_overall_alert_active=overall.is_alert_active,
        margin_level=metrics.margin_level if metrics else 0.0,
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

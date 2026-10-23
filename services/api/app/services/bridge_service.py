import os
import json
import time
import uuid
import threading
from datetime import datetime, timezone
from typing import Optional, List, Dict
from fastapi import HTTPException, status
from app.models.bridge import (
    HeartbeatPayload,
    HeartbeatResponse,
    BridgeStatusResponse,
    CommandItem,
    PositionItem,
    MarketQuoteItem,
    ClosedTradeItem,
    TradeHistoryResponse,
    EquityPointItem,
    EquityCurveResponse,
    InitialDepositRequest,
    InitialDepositResponse,
)
from app.core.config import settings
from app.services.user_service import user_service


class UserBridgeSession:
    def __init__(self, username: str):
        self.username = username
        self.account_number: Optional[int] = None
        self.server: Optional[str] = None
        self.latest_payload: Optional[HeartbeatPayload] = None
        self.last_received_time: Optional[float] = None
        self.pending_commands: List[CommandItem] = []
        self.is_kill_switch_active: bool = False
        self.kill_switch_reason: Optional[str] = None
        self.kill_switch_time: Optional[int] = None
        self.kill_switch_user: Optional[str] = None
        self.previous_positions_map: dict = {}
        self.previous_balance: Optional[float] = None
        self.market_quotes: Dict[str, MarketQuoteItem] = {}
        self.account_trades: Dict[int, Dict[int, ClosedTradeItem]] = {}
        self.account_initial_deposits: Dict[int, float] = {}
        self.account_custom_deposits: Dict[int, Optional[float]] = {}
        self.closed_trades_map: Dict[int, ClosedTradeItem] = {}
        self.equity_snapshots: List[dict] = []
        self.chart_symbol: Optional[str] = None
        self.mt5_initial_deposit: Optional[float] = None
        self.custom_initial_deposit: Optional[float] = None

    def get_effective_initial_deposit(self, account_number: Optional[int] = None) -> Optional[float]:
        acct = account_number or self.account_number
        if acct:
            custom = self.account_custom_deposits.get(acct)
            if custom is not None and custom > 0:
                return custom
            mt5_dep = self.account_initial_deposits.get(acct)
            if mt5_dep is not None and mt5_dep > 0:
                return mt5_dep

        # Fallback to current session payload balance
        if self.latest_payload and self.latest_payload.balance > 0:
            return self.latest_payload.balance
        return None


class BridgeService:
    def __init__(self):
        self._lock = threading.Lock()
        self._sessions: Dict[str, UserBridgeSession] = {}

    def _normalize_user(self, username: Optional[str]) -> str:
        return (username or settings.ADMIN_USERNAME).strip().lower()

    def _get_or_create_session(self, username: Optional[str]) -> UserBridgeSession:
        user_key = self._normalize_user(username)
        if user_key not in self._sessions:
            self._sessions[user_key] = UserBridgeSession(username=user_key)
        return self._sessions[user_key]

    def reset_state(self):
        """Reset internal state across all sessions (for unit test isolation)."""
        with self._lock:
            self._sessions.clear()

    def get_equity(self, username: Optional[str] = None) -> Optional[float]:
        with self._lock:
            session = self._get_or_create_session(username)
            if session.latest_payload and session.latest_payload.equity > 0:
                return session.latest_payload.equity
            return None

    def trigger_kill_switch(self, reason: str = "Manual Emergency Watchdog Alert", username: str = "admin") -> dict:
        current_time = int(time.time())
        with self._lock:
            session = self._get_or_create_session(username)
            session.is_kill_switch_active = True
            session.kill_switch_reason = reason
            session.kill_switch_time = current_time
            session.kill_switch_user = username
            open_count = len(session.latest_payload.positions) if session.latest_payload else 0

        # Dispatch structured Telegram watchdog alert (zero remote execution commands sent to MT5)
        try:
            from app.services.telegram_service import telegram_service
            telegram_service.send_kill_switch_alert_background(
                reason=reason,
                triggered_by=username,
                closed_count=open_count
            )
        except Exception:
            pass

        return {
            "status": "engaged",
            "is_kill_switch_active": True,
            "reason": reason,
            "triggered_at": current_time,
            "triggered_by": username,
            "command_id": None,
            "message": "Risk Watchdog alert engaged. Telegram notification dispatched. Note: In Pure Read-Only mode, no liquidation commands are sent to MT5."
        }

    def disarm_kill_switch(self, username: str = "admin") -> dict:
        with self._lock:
            session = self._get_or_create_session(username)
            session.is_kill_switch_active = False
            session.kill_switch_reason = None
            session.kill_switch_time = None
            session.kill_switch_user = None

        return {
            "status": "disarmed",
            "is_kill_switch_active": False,
            "message": "Risk Watchdog alert disarmed and unlocked. Normal analytical operations restored.",
            "unlocked_by": username
        }

    def get_kill_switch_status(self, username: Optional[str] = None) -> dict:
        with self._lock:
            session = self._get_or_create_session(username)
            return {
                "is_kill_switch_active": session.is_kill_switch_active,
                "kill_switch_reason": session.kill_switch_reason,
                "kill_switch_time": session.kill_switch_time,
                "kill_switch_user": session.kill_switch_user,
                "default_risk_percent": settings.DEFAULT_RISK_PER_TRADE_PERCENT,
                "max_risk_percent": settings.MAX_RISK_PER_TRADE_PERCENT,
                "max_daily_drawdown_percent": settings.MAX_DAILY_DRAWDOWN_PERCENT,
                "min_lot": settings.MIN_LOT_SIZE,
                "max_lot": settings.MAX_LOT_SIZE
            }

    def process_heartbeat(self, payload: HeartbeatPayload, bridge_token: Optional[str] = None) -> HeartbeatResponse:
        current_time = time.time()
        token = (bridge_token or payload.bridge_token or "").strip()

        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Bridge Token required. Please provide X-Bridge-Token header or bridge_token in payload."
            )

        user = user_service.get_user_by_bridge_token(token)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Bridge Token. Authentication failed."
            )

        username = user["username"]
        closed_positions = []

        with self._lock:
            session = self._get_or_create_session(username)

            # Determine whether MT5 account has changed
            acct = payload.account_number
            account_changed = False
            if session.account_number is not None and acct != session.account_number:
                account_changed = True
            elif session.latest_payload is not None and acct != session.latest_payload.account_number:
                account_changed = True

            if account_changed:
                # MT5 Account has switched! Reset previous account's telemetry
                session.previous_positions_map.clear()
                session.equity_snapshots.clear()
                session.account_trades[acct] = {}
                session.closed_trades_map = session.account_trades[acct]
                session.previous_balance = payload.balance
                # Ensure custom initial deposit is isolated and does not leak from previous account
                session.custom_initial_deposit = session.account_custom_deposits.get(acct)

            session.account_number = acct
            session.server = payload.server

            # Ensure active account trades map exists and closed_trades_map points to it
            if session.account_number not in session.account_trades:
                session.account_trades[session.account_number] = {}
            session.closed_trades_map = session.account_trades[session.account_number]

            # Update market quotes
            if payload.market_quotes:
                for q in payload.market_quotes:
                    session.market_quotes[q.symbol.upper()] = q

            # Update closed trades from MT5 history for this account
            if payload.closed_trades is not None:
                session.closed_trades_map.clear()
                for t in payload.closed_trades:
                    session.closed_trades_map[t.ticket] = t

            # Record initial deposit for this specific account
            if payload.initial_deposit and payload.initial_deposit > 0:
                session.account_initial_deposits[acct] = payload.initial_deposit
            elif acct not in session.account_initial_deposits or session.account_initial_deposits[acct] <= 0:
                session.account_initial_deposits[acct] = payload.balance
            session.mt5_initial_deposit = session.account_initial_deposits.get(acct)

            if payload.chart_symbol:
                session.chart_symbol = payload.chart_symbol.strip()

            # Record equity snapshot
            if payload.equity > 0:
                session.equity_snapshots.append({
                    "timestamp": int(current_time),
                    "equity": payload.equity,
                    "balance": payload.balance
                })
                if len(session.equity_snapshots) > 500:
                    session.equity_snapshots.pop(0)

            # Detect closed positions (only if account did not switch to avoid false alerts)
            current_tickets = {pos.ticket for pos in payload.positions}
            if session.previous_positions_map and not account_changed:
                for old_ticket, old_pos in session.previous_positions_map.items():
                    if old_ticket not in current_tickets:
                        closed_positions.append(old_pos)

            session.previous_positions_map = {pos.ticket: pos for pos in payload.positions}
            session.previous_balance = payload.balance
            session.latest_payload = payload
            session.last_received_time = current_time

        # Dispatch alerts for closed trades
        if closed_positions:
            try:
                from app.services.telegram_service import telegram_service
                for pos in closed_positions:
                    pnl = pos.pnl if pos.pnl != 0 else (pos.profit or 0.0)
                    telegram_service.send_trade_closed_alert_background(
                        ticket=pos.ticket,
                        symbol=pos.symbol,
                        pnl=pnl,
                        reason="TP / SL / Manual Close"
                    )
            except Exception:
                pass

        # In Pure Read-Only Journal architecture, Pipstride never sends execution commands to MT5
        with self._lock:
            session.pending_commands.clear()

        return HeartbeatResponse(
            status="ok",
            server_time=int(current_time),
            commands=[]
        )

    def submit_order(self, *args, **kwargs):
        """Pure Read-Only Journal Enforcement: Direct order execution is permanently disabled."""
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Pipstride is a 100% Pure Read-Only Journal platform. Trade execution and liquidations are disabled."
        )

    def get_positions(self, username: Optional[str] = None) -> List[PositionItem]:
        current_time = time.time()
        with self._lock:
            session = self._get_or_create_session(username)
            if session.last_received_time is None or session.latest_payload is None:
                return []
            if (current_time - session.last_received_time) > settings.HEARTBEAT_TIMEOUT_SECONDS:
                return []
            return list(session.latest_payload.positions)

    def get_market_quotes(self, username: Optional[str] = None) -> List[MarketQuoteItem]:
        with self._lock:
            session = self._get_or_create_session(username)
            return list(session.market_quotes.values())

    def reset_trade_history(self, username: Optional[str] = None) -> dict:
        with self._lock:
            session = self._get_or_create_session(username)
            if session.account_number and session.account_number in session.account_trades:
                session.account_trades[session.account_number].clear()
            session.closed_trades_map.clear()
            session.equity_snapshots.clear()
            acct = session.account_number
        return {
            "status": "success",
            "message": "Riwayat jurnal berhasil di-reset dan disinkronkan ulang dengan akun MT5 aktif.",
            "account_number": acct
        }

    def get_trade_history(self, username: Optional[str] = None) -> TradeHistoryResponse:
        with self._lock:
            session = self._get_or_create_session(username)
            acct = session.account_number
            active_trades_map = session.account_trades.get(acct) if acct else {}
            if active_trades_map is None:
                active_trades_map = {}

            trades = sorted(
                list(active_trades_map.values()),
                key=lambda x: x.close_time or 0,
                reverse=True
            )
            total = len(trades)
            if total == 0:
                return TradeHistoryResponse(
                    trades=[],
                    net_pnl=0.0,
                    win_rate=0.0,
                    profit_factor=0.0,
                    total_trades=0,
                    winning_trades=0,
                    losing_trades=0,
                    gross_profit=0.0,
                    gross_loss=0.0,
                    account_number=acct,
                    server=session.server
                )

            profits = [t.profit for t in trades]
            net_pnl = round(sum(profits), 2)
            wins = sum(1 for p in profits if p > 0)
            losses = sum(1 for p in profits if p < 0)
            win_rate = round((wins / total) * 100.0, 1) if total > 0 else 0.0

            gross_profit = round(sum(p for p in profits if p > 0), 2)
            gross_loss = round(abs(sum(p for p in profits if p < 0)), 2)
            profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else (99.99 if gross_profit > 0 else 0.0)

            return TradeHistoryResponse(
                trades=trades,
                net_pnl=net_pnl,
                win_rate=win_rate,
                profit_factor=profit_factor,
                total_trades=total,
                winning_trades=wins,
                losing_trades=losses,
                gross_profit=gross_profit,
                gross_loss=gross_loss,
                account_number=acct,
                server=session.server
            )

    def get_initial_deposit_info(self, username: Optional[str] = None) -> dict:
        with self._lock:
            session = self._get_or_create_session(username)
            acct = session.account_number
            eff_deposit = session.get_effective_initial_deposit(acct)
            bal = session.latest_payload.balance if session.latest_payload else (eff_deposit or 0.0)
            eq = session.latest_payload.equity if session.latest_payload else (eff_deposit or 0.0)
            settled_pnl = round(bal - eff_deposit, 2) if eff_deposit else 0.0
            settled_pnl_pct = round((settled_pnl / eff_deposit) * 100.0, 2) if eff_deposit else 0.0
            all_time_pnl = round(eq - eff_deposit, 2) if eff_deposit else 0.0
            all_time_pnl_pct = round((all_time_pnl / eff_deposit) * 100.0, 2) if eff_deposit else 0.0

            custom_override = session.account_custom_deposits.get(acct) if acct else None
            is_overridden = custom_override is not None and custom_override > 0
            mt5_dep = session.account_initial_deposits.get(acct) if acct else None
            source = "override" if is_overridden else ("mt5" if mt5_dep else "balance")
            return {
                "status": "success",
                "initial_deposit": eff_deposit,
                "is_overridden": is_overridden,
                "source": source,
                "settled_pnl": settled_pnl,
                "settled_pnl_percent": settled_pnl_pct,
                "all_time_pnl": all_time_pnl,
                "all_time_pnl_percent": all_time_pnl_pct,
                "account_number": acct,
                "message": "Initial deposit retrieved successfully."
            }

    def set_initial_deposit_override(self, initial_deposit: Optional[float], username: Optional[str] = None) -> dict:
        user_key = self._normalize_user(username)
        with self._lock:
            session = self._get_or_create_session(user_key)
            acct = session.account_number
            if initial_deposit is not None and float(initial_deposit) > 0:
                val = round(float(initial_deposit), 2)
                session.custom_initial_deposit = val
                if acct:
                    session.account_custom_deposits[acct] = val
            else:
                session.custom_initial_deposit = None
                if acct:
                    session.account_custom_deposits.pop(acct, None)

        user_service.set_custom_initial_deposit(user_key, session.custom_initial_deposit)
        return self.get_initial_deposit_info(username=user_key)

    def get_equity_curve(self, time_range: str = "1M", username: Optional[str] = None) -> EquityCurveResponse:
        current_time = time.time()
        rng = (time_range or "1M").strip().upper()

        with self._lock:
            session = self._get_or_create_session(username)
            acct = session.account_number
            cur_bal = session.latest_payload.balance if session.latest_payload else 0.0
            cur_eq = session.latest_payload.equity if session.latest_payload else cur_bal
            eff_deposit = session.get_effective_initial_deposit(acct) or cur_bal

            if rng in ("DAY", "1D", "D"):
                now_utc = datetime.now(timezone.utc)
                start_ts = int(datetime(now_utc.year, now_utc.month, now_utc.day, tzinfo=timezone.utc).timestamp())
            elif rng in ("WEEK", "1W", "W"):
                start_ts = int(current_time - (7 * 86400))
            elif rng in ("MONTH", "1M", "M"):
                start_ts = int(current_time - (30 * 86400))
            else:
                start_ts = 0

            active_trades_map = session.account_trades.get(acct) if acct else {}
            if active_trades_map is None:
                active_trades_map = {}

            trades_in_window = [
                t for t in active_trades_map.values()
                if (t.close_time or 0) >= start_ts
            ]
            trades_in_window.sort(key=lambda x: x.close_time or 0)

            total_profit_in_window = sum(t.profit for t in trades_in_window)
            starting_bal_window = round(cur_bal - total_profit_in_window, 2)
            if starting_bal_window <= 0 and eff_deposit > 0:
                starting_bal_window = eff_deposit

            points: List[EquityPointItem] = []
            p0_time = start_ts if start_ts > 0 else (trades_in_window[0].close_time if trades_in_window else int(current_time - 3600))
            points.append(EquityPointItem(
                timestamp=p0_time,
                balance=starting_bal_window,
                equity=starting_bal_window
            ))

            running_bal = starting_bal_window
            for t in trades_in_window:
                running_bal = round(running_bal + t.profit, 2)
                points.append(EquityPointItem(
                    timestamp=t.close_time,
                    balance=running_bal,
                    equity=running_bal
                ))

            points.append(EquityPointItem(
                timestamp=int(current_time),
                balance=cur_bal,
                equity=cur_eq
            ))

            equities = [p.equity for p in points]
            peak_eq = max(equities) if equities else cur_eq
            starting_eq = points[0].equity if points else cur_eq

            all_time_pnl = round(cur_eq - eff_deposit, 2) if eff_deposit else 0.0
            roi_percent = round((all_time_pnl / eff_deposit) * 100.0, 2) if eff_deposit else 0.0

            return EquityCurveResponse(
                starting_equity=starting_eq,
                initial_deposit=eff_deposit,
                current_equity=cur_eq,
                peak_equity=peak_eq,
                all_time_pnl=all_time_pnl,
                roi_percent=roi_percent,
                account_number=acct,
                server=session.server,
                points=points
            )

    def get_status(self, username: Optional[str] = None) -> BridgeStatusResponse:
        current_time = time.time()
        with self._lock:
            session = self._get_or_create_session(username)
            acct = session.account_number
            pending_count = len(session.pending_commands)
            eff_deposit = session.get_effective_initial_deposit(acct)
            custom_override = session.account_custom_deposits.get(acct) if acct else None
            is_overridden = custom_override is not None and custom_override > 0
            
            active_trades_map = session.account_trades.get(acct) if acct else {}
            closed_trades_count = len(active_trades_map) if active_trades_map is not None else 0

            if session.last_received_time is None or session.latest_payload is None:
                return BridgeStatusResponse(
                    is_connected=False,
                    terminal_connected=False,
                    last_heartbeat_at=None,
                    seconds_since_last_heartbeat=None,
                    metrics=None,
                    initial_deposit=eff_deposit,
                    is_deposit_overridden=is_overridden,
                    settled_pnl=0.0,
                    settled_pnl_percent=0.0,
                    all_time_pnl=0.0,
                    all_time_pnl_percent=0.0,
                    positions=[],
                    market_quotes=list(session.market_quotes.values()),
                    chart_symbol=session.chart_symbol,
                    closed_trades_count=closed_trades_count,
                    pending_commands_count=pending_count,
                    is_kill_switch_active=session.is_kill_switch_active,
                    kill_switch_reason=session.kill_switch_reason,
                    kill_switch_time=session.kill_switch_time
                )
            
            diff = current_time - session.last_received_time
            is_active = (diff <= settings.HEARTBEAT_TIMEOUT_SECONDS)
            positions = list(session.latest_payload.positions) if is_active else []
            
            bal = session.latest_payload.balance
            eq = session.latest_payload.equity
            settled_pnl = round(bal - eff_deposit, 2) if eff_deposit else 0.0
            settled_pnl_pct = round((settled_pnl / eff_deposit) * 100.0, 2) if eff_deposit else 0.0
            all_time_pnl = round(eq - eff_deposit, 2) if eff_deposit else 0.0
            all_time_pnl_pct = round((all_time_pnl / eff_deposit) * 100.0, 2) if eff_deposit else 0.0

            safe_metrics = session.latest_payload.model_copy(update={"bridge_token": None}) if session.latest_payload else None

            return BridgeStatusResponse(
                is_connected=is_active,
                terminal_connected=session.latest_payload.terminal_connected if is_active else False,
                last_heartbeat_at=int(session.last_received_time),
                seconds_since_last_heartbeat=round(diff, 2),
                metrics=safe_metrics,
                initial_deposit=eff_deposit,
                is_deposit_overridden=is_overridden,
                settled_pnl=settled_pnl,
                settled_pnl_percent=settled_pnl_pct,
                all_time_pnl=all_time_pnl,
                all_time_pnl_percent=all_time_pnl_pct,
                positions=positions,
                market_quotes=list(session.market_quotes.values()),
                chart_symbol=session.chart_symbol,
                closed_trades_count=closed_trades_count,
                pending_commands_count=pending_count,
                is_kill_switch_active=session.is_kill_switch_active,
                kill_switch_reason=session.kill_switch_reason,
                kill_switch_time=session.kill_switch_time
            )


bridge_service = BridgeService()

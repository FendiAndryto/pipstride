import logging
import asyncio
from typing import Optional, Dict, Any
import httpx
from app.core.config import settings

logger = logging.getLogger("telegram_service")


class TelegramService:
    def __init__(self):
        self._api_url = "https://api.telegram.org/bot"

    @property
    def is_configured(self) -> bool:
        return bool(settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_CHAT_ID)

    @property
    def is_enabled(self) -> bool:
        return bool(self.is_configured and settings.TELEGRAM_NOTIFICATIONS_ENABLED)

    def get_status(self) -> Dict[str, Any]:
        return {
            "configured": self.is_configured,
            "enabled": self.is_enabled,
            "bot_token_set": bool(settings.TELEGRAM_BOT_TOKEN),
            "chat_id_set": bool(settings.TELEGRAM_CHAT_ID)
        }

    async def send_message(self, text: str, parse_mode: str = "HTML") -> bool:
        if not self.is_enabled:
            logger.debug("Telegram notifications are disabled or not configured.")
            return False

        url = f"{self._api_url}{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": settings.TELEGRAM_CHAT_ID,
            "text": text,
            "parse_mode": parse_mode
        }

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.post(url, json=payload)
                if res.status_code == 200:
                    logger.info("Telegram notification delivered successfully.")
                    return True
                else:
                    logger.warning("Telegram API error HTTP %s: %s", res.status_code, res.text)
                    return False
        except Exception as e:
            logger.error("Failed to deliver Telegram notification: %s", e)
            return False

    def _run_in_background(self, coro):
        """Execute a coroutine in background task if event loop is running, or in a worker thread."""
        if not self.is_enabled:
            try:
                coro.close()
            except Exception:
                pass
            return
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(coro)
        except RuntimeError:
            import threading
            threading.Thread(target=lambda: asyncio.run(coro), daemon=True).start()

    def send_message_background(self, text: str, parse_mode: str = "HTML"):
        """Fire-and-forget background notification task."""
        self._run_in_background(self.send_message(text, parse_mode))

    def send_signal_alert_background(self, signal: Dict[str, Any]):
        self._run_in_background(self.send_signal_alert(signal))

    def send_order_alert_background(self, order: Dict[str, Any]):
        self._run_in_background(self.send_order_alert(order))

    def send_kill_switch_alert_background(self, reason: str, triggered_by: str = "Admin", closed_count: int = 0):
        self._run_in_background(self.send_kill_switch_alert(reason, triggered_by, closed_count))

    def send_drawdown_lockout_alert_background(self, drawdown_percent: float, drawdown_amount: float, limit_percent: float):
        self._run_in_background(self.send_drawdown_lockout_alert(drawdown_percent, drawdown_amount, limit_percent))

    def send_trade_closed_alert_background(self, ticket: int, symbol: str, pnl: float, reason: str = "Target / Stop / Manual"):
        self._run_in_background(self.send_trade_closed_alert(ticket, symbol, pnl, reason))

    async def send_signal_alert(self, signal: Dict[str, Any]) -> bool:
        action = signal.get("action", "SIGNAL")
        symbol = signal.get("symbol", "UNKNOWN")
        confidence = signal.get("confidence", 0.0)
        price = signal.get("current_price", 0.0)
        sl = signal.get("suggested_sl", 0.0)
        tp = signal.get("suggested_tp", 0.0)
        status_name = signal.get("status", "PENDING")
        is_auto = signal.get("is_autopilot", False)

        icon = "🟢" if action == "BUY" else "🔴"
        mode_str = "⚡ <b>Autonomous Auto-Pilot</b>" if is_auto else "👤 <b>Semi-Auto Approval Required</b>"

        msg = (
            f"{icon} <b>TRADING SIGNAL DETECTED</b>\n\n"
            f"<b>Pair:</b> <code>{symbol}</code>\n"
            f"<b>Action:</b> <b>{action}</b> (Confidence: {confidence:.0%})\n"
            f"<b>Entry Price:</b> <code>{price:.5f}</code>\n"
            f"<b>Stop Loss:</b> <code>{sl:.5f}</code>\n"
            f"<b>Take Profit:</b> <code>{tp:.5f}</code>\n"
            f"<b>Execution Mode:</b> {mode_str}\n"
            f"<b>Status:</b> <i>{status_name}</i>"
        )
        return await self.send_message(msg)

    async def send_order_alert(self, order: Dict[str, Any]) -> bool:
        action = order.get("action", "ORDER")
        symbol = order.get("symbol", "")
        volume = order.get("volume", 0.0)
        ticket = order.get("ticket", "")
        sl = order.get("sl", 0.0)
        tp = order.get("tp", 0.0)
        price = order.get("price", 0.0)

        icon = "🚀" if action == "BUY" else "🔻" if action == "SELL" else "🔄"

        msg = (
            f"{icon} <b>ORDER EXECUTED TO MT5</b>\n\n"
            f"<b>Ticket:</b> #<code>{ticket or 'Pending'}</code>\n"
            f"<b>Symbol:</b> <code>{symbol}</code>\n"
            f"<b>Action:</b> <b>{action}</b>\n"
            f"<b>Volume:</b> <code>{volume:.2f} Lots</code>\n"
        )
        if price:
            msg += f"<b>Price:</b> <code>{price:.5f}</code>\n"
        if sl:
            msg += f"<b>Stop Loss:</b> <code>{sl:.5f}</code>\n"
        if tp:
            msg += f"<b>Take Profit:</b> <code>{tp:.5f}</code>\n"

        return await self.send_message(msg)

    async def send_kill_switch_alert(
        self,
        reason: str,
        triggered_by: str = "Admin",
        closed_count: int = 0
    ) -> bool:
        msg = (
            f"🚨 <b>EMERGENCY KILL SWITCH ENGAGED</b>\n\n"
            f"<b>Triggered by:</b> <code>{triggered_by}</code>\n"
            f"<b>Reason:</b> <code>{reason}</code>\n"
            f"<b>Positions Closed:</b> <code>{closed_count}</code>\n"
            f"<b>Status:</b> <b>TRADING ENGINE LOCKED OUT</b>\n\n"
            f"<i>All autonomous and manual trade executions are halted.</i>"
        )
        return await self.send_message(msg)

    async def send_drawdown_lockout_alert(
        self,
        drawdown_percent: float,
        drawdown_amount: float,
        limit_percent: float
    ) -> bool:
        msg = (
            f"⛔ <b>DAILY DRAWDOWN GUARD BREACHED</b>\n\n"
            f"<b>Drawdown Today:</b> <code>-{drawdown_percent:.2f}%</code> (${drawdown_amount:,.2f})\n"
            f"<b>Risk Ceiling:</b> <code>{limit_percent:.2f}%</code>\n"
            f"<b>Safety Action:</b> <b>Auto-Pilot Disabled & Trades Halted</b>\n\n"
            f"<i>Trading is locked for the remainder of the day to protect capital.</i>"
        )
        return await self.send_message(msg)

    async def send_trade_closed_alert(
        self,
        ticket: int,
        symbol: str,
        pnl: float,
        reason: str = "Target / Stop / Manual"
    ) -> bool:
        icon = "💵" if pnl >= 0 else "📉"
        pnl_str = f"+${pnl:.2f}" if pnl >= 0 else f"-${abs(pnl):.2f}"

        msg = (
            f"{icon} <b>POSITION CLOSED</b>\n\n"
            f"<b>Ticket:</b> #<code>{ticket}</code> (<code>{symbol}</code>)\n"
            f"<b>Realized PnL:</b> <b>{pnl_str}</b>\n"
            f"<b>Close Reason:</b> <i>{reason}</i>"
        )
        return await self.send_message(msg)


telegram_service = TelegramService()

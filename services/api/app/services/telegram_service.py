"""Telegram notifications for journal and connection events.

Pipstride never sends trade commands, so this module only delivers
informational messages: connection health, passive drawdown warnings, and
closed-trade recaps.
"""

import asyncio
import logging
from typing import Any, Dict

import httpx

from app.core.config import settings

logger = logging.getLogger("telegram_service")


class TelegramService:
    def __init__(self) -> None:
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
            "chat_id_set": bool(settings.TELEGRAM_CHAT_ID),
        }

    async def send_message(self, text: str, parse_mode: str = "HTML") -> bool:
        if not self.is_enabled:
            logger.debug("Telegram notifications are disabled or not configured.")
            return False

        url = f"{self._api_url}{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": settings.TELEGRAM_CHAT_ID,
            "text": text,
            "parse_mode": parse_mode,
        }

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.post(url, json=payload)
                if res.status_code == 200:
                    logger.info("Telegram notification delivered successfully.")
                    return True
                logger.warning("Telegram API error HTTP %s: %s", res.status_code, res.text)
                return False
        except Exception as exc:  # pragma: no cover - network failure path
            logger.error("Failed to deliver Telegram notification: %s", exc)
            return False

    def _run_in_background(self, coro) -> None:
        """Run a coroutine as a task when a loop exists, else in a worker thread."""
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

    def send_message_background(self, text: str, parse_mode: str = "HTML") -> None:
        """Fire-and-forget background notification task."""
        self._run_in_background(self.send_message(text, parse_mode))

    async def send_connection_alert(self, label: str, account_number: int, is_online: bool) -> bool:
        state = "🟢 <b>MT5 TERHUBUNG</b>" if is_online else "🔴 <b>MT5 TERPUTUS</b>"
        message = (
            f"{state}\n\n"
            f"<b>Koneksi:</b> {label}\n"
            f"<b>Akun:</b> <code>#{account_number}</code>"
        )
        return await self.send_message(message)

    async def send_drawdown_alert(
        self, drawdown_percent: float, limit_percent: float, account_number: int
    ) -> bool:
        message = (
            "⚠️ <b>DRAWDOWN WATCHDOG</b>\n\n"
            f"<b>Akun:</b> <code>#{account_number}</code>\n"
            f"<b>Drawdown:</b> {drawdown_percent:.2f}%\n"
            f"<b>Ambang peringatan:</b> {limit_percent:.2f}%\n\n"
            "Ini hanya notifikasi. Pipstride tidak menutup posisi atau mengirim order."
        )
        return await self.send_message(message)

    async def send_trade_closed_alert(
        self, ticket: int, symbol: str, pnl: float, reason: str = "Closed"
    ) -> bool:
        icon = "🟢" if pnl >= 0 else "🔴"
        message = (
            f"{icon} <b>TRADE CLOSED</b>\n\n"
            f"<b>Ticket:</b> <code>#{ticket}</code>\n"
            f"<b>Pair:</b> <code>{symbol}</code>\n"
            f"<b>PnL:</b> <code>{pnl:+.2f}</code>\n"
            f"<b>Reason:</b> {reason}"
        )
        return await self.send_message(message)

    def send_trade_closed_alert_background(
        self, ticket: int, symbol: str, pnl: float, reason: str = "Closed"
    ) -> None:
        self._run_in_background(self.send_trade_closed_alert(ticket, symbol, pnl, reason))


telegram_service = TelegramService()

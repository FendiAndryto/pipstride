"""Transactional email for account recovery.

SMTP is optional. When it is not configured the message is logged (development)
so the flow stays testable without a mail server; in production a missing SMTP
setup is logged as a warning without leaking the token.
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger(__name__)


def _mask(email: str) -> str:
    local, _, domain = (email or "").partition("@")
    if not domain:
        return "***"
    return f"{local[:1]}***@{domain}"


class EmailService:
    @property
    def is_configured(self) -> bool:
        return bool(settings.SMTP_HOST)

    def send(self, to: str, subject: str, body: str) -> bool:
        if not self.is_configured:
            if settings.is_production:
                logger.warning(
                    "SMTP is not configured; %s was not sent to %s", subject, _mask(to)
                )
            else:
                logger.info("EMAIL (log-only) to=%s subject=%s\n%s", to, subject, body)
            return False

        message = EmailMessage()
        message["From"] = settings.SMTP_FROM
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)

        try:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
                if settings.SMTP_STARTTLS:
                    smtp.starttls()
                if settings.SMTP_USERNAME:
                    smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                smtp.send_message(message)
            return True
        except Exception as exc:  # pragma: no cover - depends on external SMTP
            logger.error("Failed to send %s to %s: %s", subject, _mask(to), exc)
            return False

    def send_password_reset(self, to: str, link: str, ttl_minutes: int) -> bool:
        subject = "Reset your Pipstride password"
        body = (
            "Someone requested a password reset for your Pipstride account.\n\n"
            f"Open this link to choose a new password (valid for {ttl_minutes} minutes):\n\n"
            f"{link}\n\n"
            "If you did not request this, you can ignore this email; your password stays unchanged.\n"
        )
        return self.send(to, subject, body)

    def send_email_verification(self, to: str, link: str, ttl_hours: int) -> bool:
        subject = "Verify your Pipstride email address"
        body = (
            "Confirm this address so it can be used for password recovery and receipts.\n\n"
            f"Open this link to verify (valid for {ttl_hours} hours):\n\n"
            f"{link}\n\n"
            "If you did not add this address, you can ignore this email.\n"
        )
        return self.send(to, subject, body)


email_service = EmailService()

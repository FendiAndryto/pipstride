"""Structured JSON logging with request correlation.

One line per request is emitted by :class:`RequestContextMiddleware`, carrying a
request id that is also echoed in the ``X-Request-ID`` response header and
attached to every log record produced while handling that request.
"""

from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

REQUEST_ID_HEADER = "X-Request-ID"
NOISY_PATHS = {"/health", "/"}

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")

_EXTRA_FIELDS = ("method", "path", "status_code", "duration_ms", "client_ip")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(
                timespec="milliseconds"
            ),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_ctx.get(),
        }
        for field in _EXTRA_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())

    # The middleware logs every request with status and duration, so uvicorn's
    # duplicate access lines are redundant. Keep uvicorn errors visible.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(level.upper())


access_logger = logging.getLogger("pipstride.access")


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = incoming.strip()[:64] or uuid.uuid4().hex[:16]
        token = request_id_ctx.set(request_id)
        started = time.perf_counter()
        status_code = 500

        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers[REQUEST_ID_HEADER] = request_id
            return response
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 1)
            if request.url.path not in NOISY_PATHS:
                access_logger.info(
                    "%s %s -> %s",
                    request.method,
                    request.url.path,
                    status_code,
                    extra={
                        "method": request.method,
                        "path": request.url.path,
                        "status_code": status_code,
                        "duration_ms": duration_ms,
                        "client_ip": request.client.host if request.client else None,
                    },
                )
            request_id_ctx.reset(token)

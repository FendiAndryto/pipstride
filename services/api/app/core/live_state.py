"""Live telemetry state for active MT5 connections.

The canonical history lives in PostgreSQL (snapshots + trades). This module
only holds the *latest* payload per connection, which is hot data used by the
dashboard. Redis is used when configured so that multiple API workers share the
same view; otherwise a bounded in-process cache keeps local development simple.
"""

from __future__ import annotations

import json
import time
from typing import Any, Optional

from app.core.config import settings

KEY_PREFIX = "pipstride:live:"
TTL_SECONDS = 120


class _MemoryBackend:
    def __init__(self) -> None:
        self._store: dict[str, tuple[float, str]] = {}

    def set(self, key: str, value: str, ttl: int) -> None:
        self._store[key] = (time.time() + ttl, value)

    def get(self, key: str) -> Optional[str]:
        entry = self._store.get(key)
        if not entry:
            return None
        expires_at, value = entry
        if expires_at < time.time():
            self._store.pop(key, None)
            return None
        return value

    def delete(self, key: str) -> None:
        self._store.pop(key, None)


class _RedisBackend:
    def __init__(self, url: str) -> None:
        import redis

        self._client = redis.Redis.from_url(url, decode_responses=True)

    def set(self, key: str, value: str, ttl: int) -> None:
        self._client.setex(key, ttl, value)

    def get(self, key: str) -> Optional[str]:
        return self._client.get(key)

    def delete(self, key: str) -> None:
        self._client.delete(key)


def _build_backend():
    if settings.REDIS_URL:
        try:
            return _RedisBackend(settings.REDIS_URL)
        except Exception:  # pragma: no cover - fall back to memory on bad config
            return _MemoryBackend()
    return _MemoryBackend()


_backend = _build_backend()


def save_live_payload(connection_id: str, payload: dict[str, Any]) -> None:
    _backend.set(f"{KEY_PREFIX}{connection_id}", json.dumps(payload), TTL_SECONDS)


def load_live_payload(connection_id: str) -> Optional[dict[str, Any]]:
    raw = _backend.get(f"{KEY_PREFIX}{connection_id}")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def clear_live_payload(connection_id: str) -> None:
    _backend.delete(f"{KEY_PREFIX}{connection_id}")

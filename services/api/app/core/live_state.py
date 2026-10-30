"""Live telemetry state for active MT5 connections.

The canonical history lives in PostgreSQL (snapshots + trades). This module
only holds the *latest* payload per connection, which is hot data used by the
dashboard. Redis is used when configured so that multiple API workers share the
same view; otherwise a bounded in-process cache keeps local development simple.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

KEY_PREFIX = "pipstride:live:"
TTL_SECONDS = 120


class _MemoryBackend:
    """Bounded process-local cache used when Redis is not configured.

    Thread-safe: all mutations of ``self._store`` are guarded by a lock so that
    concurrent heartbeats under the default threadpool cannot corrupt state.
    """

    MAX_ENTRIES = 512

    def __init__(self) -> None:
        self._store: dict[str, tuple[float, str]] = {}
        self._lock = threading.Lock()

    def set(self, key: str, value: str, ttl: int) -> None:
        with self._lock:
            if len(self._store) >= self.MAX_ENTRIES:
                self._prune(force=True)
            self._store[key] = (time.time() + ttl, value)

    def _prune(self, force: bool = False) -> None:
        now = time.time()
        expired = [k for k, (expires_at, _) in self._store.items() if expires_at < now]
        for key in expired:
            self._store.pop(key, None)
        if force and len(self._store) >= self.MAX_ENTRIES:
            # Drop the entries closest to expiry first.
            ordered = sorted(self._store.items(), key=lambda item: item[1][0])
            for key, _ in ordered[: self.MAX_ENTRIES // 2]:
                self._store.pop(key, None)

    def get(self, key: str) -> Optional[str]:
        with self._lock:
            entry = self._store.get(key)
            if not entry:
                return None
            expires_at, value = entry
            if expires_at < time.time():
                self._store.pop(key, None)
                return None
            return value

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)


class _RedisBackend:
    """Redis-backed shared cache.

    A Redis outage must not take telemetry ingest down: durable state is already
    committed to PostgreSQL, so reads simply report "no live payload" and the
    dashboard shows the connection as stale until Redis returns.
    """

    def __init__(self, url: str) -> None:
        import redis

        self._client = redis.Redis.from_url(url, decode_responses=True)

    def set(self, key: str, value: str, ttl: int) -> None:
        try:
            self._client.setex(key, ttl, value)
        except Exception as exc:  # pragma: no cover - infra failure path
            logger.warning("Redis SETEX failed, live payload not cached: %s", exc)

    def get(self, key: str) -> Optional[str]:
        try:
            return self._client.get(key)
        except Exception as exc:  # pragma: no cover - infra failure path
            logger.warning("Redis GET failed, treating live payload as absent: %s", exc)
            return None

    def delete(self, key: str) -> None:
        try:
            self._client.delete(key)
        except Exception as exc:  # pragma: no cover - infra failure path
            logger.warning("Redis DEL failed: %s", exc)


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

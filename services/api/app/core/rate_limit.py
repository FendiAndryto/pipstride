"""Rate limiting shared across API workers.

Redis is used when configured so that limits apply to the deployment as a whole
rather than per process. Any Redis failure degrades to a local in-memory counter
instead of rejecting requests.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Optional, Tuple

from app.core.config import settings

logger = logging.getLogger(__name__)

KEY_PREFIX = "pipstride:rl:"

_Window = Tuple[int, float]  # (count, reset_at)


class _MemoryCounter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._buckets: dict[str, _Window] = {}

    def incr(self, key: str, window_seconds: int) -> _Window:
        now = time.time()
        with self._lock:
            count, reset_at = self._buckets.get(key, (0, 0.0))
            if reset_at <= now:
                count, reset_at = 1, now + window_seconds
            else:
                count += 1
            self._buckets[key] = (count, reset_at)
            return count, reset_at

    def peek(self, key: str) -> _Window:
        with self._lock:
            count, reset_at = self._buckets.get(key, (0, 0.0))
        if reset_at <= time.time():
            return 0, 0.0
        return count, reset_at

    def clear(self, key: str) -> None:
        with self._lock:
            self._buckets.pop(key, None)


class _RedisCounter:
    def __init__(self, url: str) -> None:
        self._url = url
        self._client = None
        self._lock = threading.Lock()

    def _connection(self):
        if self._client is None:
            with self._lock:
                if self._client is None:
                    import redis

                    self._client = redis.Redis.from_url(
                        self._url, decode_responses=True, socket_timeout=1.5
                    )
        return self._client

    # Lua script: atomic INCR + conditional EXPIRE (only set TTL on first hit).
    _LUA_INCR = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
"""
    _script = None

    def incr(self, key: str, window_seconds: int) -> _Window:
        client = self._connection()
        if self._script is None:
            self.__class__._script = client.register_script(self._LUA_INCR)
        result = self._script(keys=[key], args=[window_seconds], client=client)
        count, ttl = int(result[0]), int(result[1])
        return count, time.time() + max(ttl, 0)

    def peek(self, key: str) -> _Window:
        client = self._connection()
        raw = client.get(key)
        if raw is None:
            return 0, 0.0
        ttl_ms = client.pttl(key)
        reset_at = time.time() + (ttl_ms / 1000.0) if ttl_ms and ttl_ms > 0 else 0.0
        return int(raw), reset_at

    def clear(self, key: str) -> None:
        self._connection().delete(key)


_memory = _MemoryCounter()
_redis: Optional[_RedisCounter] = _RedisCounter(settings.REDIS_URL) if settings.REDIS_URL else None


def _backends():
    yield _memory
    if _redis is not None:
        yield _redis


def _call(method: str, key: str, *args):
    """Try Redis first, fall back to the local counter on any failure."""
    if _redis is not None:
        try:
            return getattr(_redis, method)(key, *args)
        except Exception as exc:  # pragma: no cover - infra failure path
            logger.warning("Redis rate limiter unavailable (%s); using local counter", exc)
    return getattr(_memory, method)(key, *args)


def _full_key(key: str) -> str:
    return f"{KEY_PREFIX}{key}"


def consume(key: str, limit: int, window_seconds: int) -> Tuple[bool, int]:
    """Count one hit for ``key`` and report whether the limit is exceeded."""
    if not settings.RATE_LIMIT_ENABLED:
        return False, 0

    count, reset_at = _call("incr", _full_key(key), window_seconds)
    if count <= limit:
        return False, 0

    retry_after = max(1, int(reset_at - time.time()) + 1)
    return True, retry_after


def peek(key: str) -> Tuple[int, int]:
    count, reset_at = _call("peek", _full_key(key))
    retry_after = max(1, int(reset_at - time.time()) + 1) if reset_at else 0
    return count, retry_after


def clear(key: str) -> None:
    for backend in _backends():
        try:
            backend.clear(_full_key(key))
        except Exception:  # pragma: no cover - infra failure path
            continue


class LoginRateLimiter:
    """Attempt-counter used by register/login.

    Only failures are counted, so a legitimate successful login resets the
    window. The interface matches the previous in-process implementation.
    """

    def __init__(self, max_attempts: int = 5, window_seconds: int = 300) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds

    def is_rate_limited(self, key: str) -> Tuple[bool, int]:
        count, retry_after = peek(key)
        if count >= self.max_attempts:
            return True, max(1, retry_after)
        return False, 0

    def record_failure(self, key: str) -> None:
        if not settings.RATE_LIMIT_ENABLED:
            return
        _call("incr", _full_key(key), self.window_seconds)

    def record_success(self, key: str) -> None:
        clear(key)

    def reset(self) -> None:
        """Test helper: drop the in-process buckets entirely."""
        _memory._buckets.clear()


rate_limiter = LoginRateLimiter()

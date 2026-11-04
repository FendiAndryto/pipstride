"""Client-IP trust tests for rate limiting."""

from starlette.requests import Request

from app.core import rate_limit
from app.core.config import settings


def _request(peer: str, headers: dict[str, str] | None = None) -> Request:
    raw_headers = [
        (key.lower().encode(), value.encode()) for key, value in (headers or {}).items()
    ]
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": raw_headers,
            "client": (peer, 12345),
        }
    )


def test_trusted_proxy_uses_valid_x_real_ip(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_IPS", "172.16.0.0/12")
    request = _request("172.18.0.2", {"X-Real-IP": "203.0.113.9"})
    assert rate_limit.get_client_ip(request) == "203.0.113.9"


def test_untrusted_peer_cannot_spoof_x_real_ip(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_IPS", "172.16.0.0/12")
    request = _request("198.51.100.7", {"X-Real-IP": "203.0.113.9"})
    assert rate_limit.get_client_ip(request) == "198.51.100.7"


def test_invalid_x_real_ip_falls_back_to_peer(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_IPS", "172.16.0.0/12")
    request = _request("172.18.0.2", {"X-Real-IP": "not-an-ip"})
    assert rate_limit.get_client_ip(request) == "172.18.0.2"


def test_cloudflare_and_forwarded_headers_are_ignored(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_IPS", "172.16.0.0/12")
    request = _request(
        "198.51.100.7",
        {"CF-Connecting-IP": "203.0.113.9", "X-Forwarded-For": "203.0.113.9"},
    )
    assert rate_limit.get_client_ip(request) == "198.51.100.7"


def test_x_forwarded_for_is_not_used_even_from_a_trusted_proxy(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_IPS", "172.16.0.0/12")
    request = _request("172.18.0.2", {"X-Forwarded-For": "203.0.113.9"})
    assert rate_limit.get_client_ip(request) == "172.18.0.2"


def test_ipv6_trusted_proxy(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_IPS", "::1/128")
    request = _request("::1", {"X-Real-IP": "2001:db8::1"})
    assert rate_limit.get_client_ip(request) == "2001:db8::1"

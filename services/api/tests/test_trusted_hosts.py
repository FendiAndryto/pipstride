"""Host header allow-list tests.

``ALLOWED_HOSTS`` is the only defence against Host header poisoning, which
matters because ``request.base_url`` is embedded in password-reset links and in
the generated MT5 onboarding package.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import Settings


def _app(allowed_hosts: str) -> TestClient:
    """A probe app wired exactly like ``app.main`` (same property, same flags)."""
    probe = FastAPI()
    probe.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=Settings(ALLOWED_HOSTS=allowed_hosts).trusted_hosts,
        www_redirect=False,
    )

    @probe.get("/health")
    async def health():  # pragma: no cover - trivial
        return {"status": "ok"}

    return TestClient(probe)


def test_configured_host_is_accepted():
    client = _app("app.example.com")
    assert client.get("/health", headers={"Host": "app.example.com"}).status_code == 200


def test_unknown_host_is_rejected():
    client = _app("app.example.com")
    assert client.get("/health", headers={"Host": "evil.example.net"}).status_code == 400


def test_host_with_port_is_accepted():
    client = _app("app.example.com")
    assert client.get("/health", headers={"Host": "app.example.com:8089"}).status_code == 200


def test_wildcard_subdomain_pattern():
    client = _app("*.example.com")
    assert client.get("/health", headers={"Host": "app.example.com"}).status_code == 200
    assert client.get("/health", headers={"Host": "example.com"}).status_code == 400


def test_loopback_always_allowed_for_container_healthcheck():
    """The Docker healthcheck probes http://127.0.0.1:8000/health."""
    client = _app("app.example.com")
    for probe in ("127.0.0.1", "localhost", "127.0.0.1:8000"):
        assert client.get("/health", headers={"Host": probe}).status_code == 200


def test_wildcard_disables_enforcement():
    client = _app("*")
    assert client.get("/health", headers={"Host": "anything.example"}).status_code == 200


def test_no_www_redirect_for_unknown_bare_host():
    """A wrong Host is a bad request, never a 307 to an attacker-shaped URL."""
    client = _app("www.example.com")
    res = client.get("/health", headers={"Host": "example.com"})
    assert res.status_code == 400
    assert "location" not in res.headers


def test_trusted_hosts_parsing_is_trimmed_and_deduped():
    hosts = Settings(ALLOWED_HOSTS=" a.example.com , b.example.com ,,").trusted_hosts
    assert hosts[:2] == ["a.example.com", "b.example.com"]
    assert hosts.count("localhost") == 1

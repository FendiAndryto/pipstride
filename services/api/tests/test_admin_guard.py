"""The admin privilege boundary is structural, not a convention (ADR 0008 §2/§3).

Two things are proven here:

1. Every module under ``api/v1/admin`` attaches ``require_role(...)`` to its
   ``APIRouter``. The checker is exercised against a bare router so deleting a
   guard turns CI red instead of shipping an unauthenticated admin surface.
2. Authorisation reads the database on every request: demotion and
   deactivation take effect for a token that was valid a second earlier.
"""

import ast
from pathlib import Path

from sqlalchemy import select

import app.api.v1.admin as admin_package
from app.db.base import SessionLocal
from app.db.models import User
from tests.conftest import current_totp

ADMIN_DIR = Path(admin_package.__file__).parent


def bare_routers(source: str) -> list[str]:
    """Return ``APIRouter(...)`` calls whose dependencies omit ``require_role``."""
    offenders = []
    for node in ast.walk(ast.parse(source)):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "APIRouter"
        ):
            dependencies = [kw for kw in node.keywords if kw.arg == "dependencies"]
            if not dependencies or "require_role" not in ast.unparse(
                dependencies[0].value
            ):
                offenders.append(ast.unparse(node))
    return offenders


def test_every_admin_router_is_guarded():
    files = sorted(ADMIN_DIR.glob("*.py"))
    assert files
    offenders = {
        path.name: bare_routers(path.read_text(encoding="utf-8"))
        for path in files
        if bare_routers(path.read_text(encoding="utf-8"))
    }
    assert offenders == {}


def test_guard_checker_rejects_a_bare_router():
    # Negative control: the architecture test must fail when the guard is removed.
    assert bare_routers('router = APIRouter(prefix="/x")\n')


def _login(client, user: dict) -> dict:
    payload = {"username": user["username"], "password": user["password"]}
    if user.get("secret"):
        payload["totp_code"] = current_totp(user["secret"])
    res = client.post("/api/v1/auth/login", json=payload)
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_admin_endpoints_reject_anonymous(client):
    for path in ("users", "connections", "audit", "metrics", "support/sessions"):
        assert client.get(f"/api/v1/admin/{path}").status_code == 401, path


def test_trader_is_forbidden(client, account):
    for path in ("users", "connections", "audit", "metrics"):
        assert (
            client.get(f"/api/v1/admin/{path}", headers=account["headers"]).status_code
            == 403
        ), path


def test_support_can_read_but_not_mutate(client, make_user):
    support = make_user("support", enrolled=True)
    headers = _login(client, support)
    assert client.get("/api/v1/admin/users", headers=headers).status_code == 200

    target = make_user("trader")
    res = client.patch(
        f"/api/v1/admin/users/{target['id']}/entitlement",
        json={"plan_code": "pro"},
        headers=headers,
    )
    assert res.status_code == 403


def test_demotion_applies_immediately(client, make_user):
    promoted = make_user("admin", enrolled=True)
    headers = _login(client, promoted)
    assert client.get("/api/v1/admin/users", headers=headers).status_code == 200

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.id == promoted["id"]))
        user.role = "trader"
        db.commit()

    # The JWT is unchanged and not expired; only the DB row moved.
    assert client.get("/api/v1/admin/users", headers=headers).status_code == 403


def test_deactivation_applies_immediately(client, make_user):
    promoted = make_user("admin", enrolled=True)
    headers = _login(client, promoted)

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.id == promoted["id"]))
        user.is_active = False
        db.commit()

    assert client.get("/api/v1/admin/users", headers=headers).status_code == 401

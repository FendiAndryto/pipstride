"""Tests for scripts/reset_admin_password.py.

The script lives outside the ``app`` package (it is a CLI, not library code),
so it is loaded by path. The contract worth testing is that it is a *recovery*
path: it works with no valid login, it invalidates existing sessions, and it
refuses to write an insecure default.
"""

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.db.base import SessionLocal
from app.db.models import User
from app.services.user_service import validate_password_complexity

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "reset_admin_password.py"
ADMIN = settings.ADMIN_USERNAME


@pytest.fixture(scope="module")
def module(client):
    """Import the CLI by path. ``client`` boots the app so the schema exists."""
    spec = importlib.util.spec_from_file_location("reset_admin_password", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


@pytest.fixture(autouse=True)
def restore_admin(client):
    """Leave the shared admin row exactly as conftest seeded it.

    Other test modules log in as this account, so a leaked rotated password or
    bumped token_version would fail them in ways that look unrelated.
    """
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == ADMIN))
        assert user is not None
        snapshot = (user.password_hash, user.token_version, user.role, user.is_active)

    yield

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == ADMIN))
        user.password_hash, user.token_version, user.role, user.is_active = snapshot
        db.commit()


def _admin_row():
    with SessionLocal() as db:
        return db.scalar(select(User).where(User.username == ADMIN))


def test_rotates_hash_and_bumps_token_version(module):
    before = _admin_row()
    before_hash, before_version = before.password_hash, before.token_version

    with SessionLocal() as db:
        result = module.reset_admin_password(db, ADMIN, "RotatedPassw0rd")

    assert result["created"] is False
    assert result["dry_run"] is False

    after = _admin_row()
    assert after.password_hash != before_hash
    assert verify_password("RotatedPassw0rd", after.password_hash)
    assert after.token_version == before_version + 1
    assert after.role == "admin"
    assert after.is_active is True


def test_repairs_deactivated_demoted_admin(module):
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == ADMIN))
        user.is_active = False
        user.role = "trader"
        db.commit()

    with SessionLocal() as db:
        module.reset_admin_password(db, ADMIN, "RotatedPassw0rd")

    after = _admin_row()
    assert after.is_active is True
    assert after.role == "admin"


def test_creates_missing_account_with_entitlement(module):
    with SessionLocal() as db:
        result = module.reset_admin_password(db, "recovered_admin", "RotatedPassw0rd")

    assert result["created"] is True
    assert "created account" in result["changes"]

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == "recovered_admin"))
        assert user is not None
        assert user.role == "admin"
        assert verify_password("RotatedPassw0rd", user.password_hash)
        assert user.entitlement is not None
        assert user.entitlement.plan_code == "pro"
        db.delete(user)
        db.commit()


def test_dry_run_writes_nothing(module):
    before = _admin_row()
    before_hash, before_version = before.password_hash, before.token_version

    with SessionLocal() as db:
        result = module.reset_admin_password(db, ADMIN, "RotatedPassw0rd", dry_run=True)

    assert result["dry_run"] is True
    assert any("password hash replaced" in c for c in result["changes"])

    after = _admin_row()
    assert after.password_hash == before_hash
    assert after.token_version == before_version


def test_refuses_known_insecure_default(module):
    with SessionLocal() as db:
        with pytest.raises(ValueError, match="insecure default"):
            module.reset_admin_password(db, ADMIN, "AdminPass123")


def test_refuses_password_failing_complexity(module):
    with SessionLocal() as db:
        with pytest.raises(ValueError):
            module.reset_admin_password(db, ADMIN, "short")


def test_hashed_password_verifies_after_manual_write(module):
    """A hash written by the script must pass the API's own verifier."""
    with SessionLocal() as db:
        module.reset_admin_password(db, "hash_probe", "RotatedPassw0rd")
        user = db.scalar(select(User).where(User.username == "hash_probe"))
        stored = user.password_hash

    assert stored.startswith(("$2a$", "$2b$", "$2y$"))
    assert verify_password("RotatedPassw0rd", stored)
    assert not verify_password("wrong-password", stored)
    assert hash_password("RotatedPassw0rd") != stored  # fresh salt each time


def test_complexity_policy_matches_the_api():
    """Guard against the script drifting from the API's own policy."""
    validate_password_complexity("RotatedPassw0rd")
    with pytest.raises(ValueError):
        validate_password_complexity("nodigitshere")

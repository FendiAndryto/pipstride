"""Reset (or create) the admin account's password from the server, without a login.

`app.main._seed_defaults()` only creates the admin when the row is missing, so
editing `ADMIN_PASSWORD` in `.env` and restarting never rotates an existing
admin password. That is deliberate — silently overwriting a password an operator
set by hand on every restart would be worse — but it left no recovery path when
the only admin is locked out. This script is that path.

It writes a fresh bcrypt hash directly to the database, so it works with no
working login. It also bumps `token_version`, which signs out every existing
session (a reset that leaves old JWTs valid is not a reset), and repairs
`role`/`is_active` if they drifted, since a deactivated or demoted admin stays
locked out even with a known password.

Password source, highest precedence first:

    --password <value>        explicit, for one-off use
    ADMIN_PASSWORD from env   the value docker compose already injects from .env
    interactive prompt        never echoed, never in shell history

Usage (from ``services/api``, or from the host via the API container):

    # Rotate to whatever ADMIN_PASSWORD in .env says
    docker exec pipstride_api python scripts/reset_admin_password.py

    # See what would change, touch nothing
    docker exec pipstride_api python scripts/reset_admin_password.py --dry-run

    # One-off password for a different account
    python scripts/reset_admin_password.py --username ops --password 'S3cur3-Passw0rd'
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.base import SessionLocal  # noqa: E402
from app.db.models import Entitlement, User  # noqa: E402
from app.services.user_service import validate_password_complexity  # noqa: E402

# Values that app.core.config.validate_runtime() refuses to boot with. The
# script runs standalone, so it has to refuse them itself.
INSECURE_PASSWORDS = {"change_this_password", "AdminPass123", ""}


def _resolve_password(cli_password: str | None) -> str:
    if cli_password:
        return cli_password
    from_env = settings.ADMIN_PASSWORD
    if from_env and from_env not in INSECURE_PASSWORDS:
        return from_env
    if from_env in INSECURE_PASSWORDS:
        print(
            "ADMIN_PASSWORD in .env is still the insecure default; "
            "falling back to an interactive prompt.",
            file=sys.stderr,
        )
    first = getpass.getpass("New admin password: ")
    second = getpass.getpass("Repeat to confirm: ")
    if first != second:
        raise SystemExit("Passwords do not match; nothing was changed.")
    return first


def reset_admin_password(
    db: Session,
    username: str,
    password: str,
    *,
    dry_run: bool = False,
) -> dict[str, object]:
    """Set ``password`` for ``username``, creating the account when missing.

    Returns a summary of what happened (or would happen, under ``dry_run``).
    """
    cleaned = (username or "").strip()
    if not cleaned:
        raise ValueError("Username must not be empty")

    validate_password_complexity(password)
    if password in INSECURE_PASSWORDS:
        raise ValueError("Refusing to set a known insecure default password")

    user = db.scalar(select(User).where(User.username == cleaned))
    created = user is None
    changes: list[str] = []

    if created:
        user = User(username=cleaned, password_hash="", role="admin", is_active=True)
        changes.append("created account")
    else:
        assert user is not None
        if user.role != "admin":
            changes.append(f"role {user.role!r} -> 'admin'")
            user.role = "admin"
        if not user.is_active:
            changes.append("reactivated (was inactive)")
            user.is_active = True

    user.password_hash = hash_password(password)
    user.token_version = int(user.token_version or 1) + 1
    changes.append("password hash replaced")
    changes.append(f"token_version -> {user.token_version} (all sessions signed out)")

    if dry_run:
        db.rollback()
        return {"username": cleaned, "created": created, "changes": changes, "dry_run": True}

    if created:
        db.add(user)
        db.flush()
        # Mirrors app.main._seed_defaults() so a script-created admin is usable
        # immediately instead of hitting a missing-entitlement path.
        db.add(Entitlement(user_id=user.id, plan_code="pro", max_connections=5))

    db.commit()
    return {"username": cleaned, "created": created, "changes": changes, "dry_run": False}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Reset the Pipstride admin password directly in the database.",
    )
    parser.add_argument(
        "--username",
        default=settings.ADMIN_USERNAME,
        help="Account to reset (default: ADMIN_USERNAME, i.e. %(default)s)",
    )
    parser.add_argument(
        "--password",
        default=None,
        help="New password (default: ADMIN_PASSWORD from env, else prompt)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would change without writing anything",
    )
    args = parser.parse_args(argv)

    try:
        password = _resolve_password(args.password)
    except (KeyboardInterrupt, EOFError):
        print("\nCanceled; nothing was changed.", file=sys.stderr)
        return 1

    with SessionLocal() as db:
        try:
            result = reset_admin_password(
                db, args.username, password, dry_run=args.dry_run
            )
        except ValueError as exc:
            print(f"Refused: {exc}", file=sys.stderr)
            return 1

    prefix = "[dry-run] would have " if result["dry_run"] else ""
    print(f"{prefix}reset password for '{result['username']}':")
    for change in result["changes"]:
        print(f"  - {change}")
    if not result["dry_run"]:
        print("Done. Log in with the new password; old sessions are invalid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

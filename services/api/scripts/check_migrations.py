"""Fail if the SQLAlchemy models and the Alembic migrations disagree.

Run after ``alembic upgrade head`` against a real PostgreSQL database. A clean
run means no migration would be produced by ``alembic revision --autogenerate``.

Usage (from ``services/api``):

    alembic upgrade head
    python scripts/check_migrations.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.migration import MigrationContext  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.models import Base  # noqa: E402


def main() -> int:
    if settings.DATABASE_URL.startswith("sqlite"):
        print(
            "Point DATABASE_URL at the migrated PostgreSQL database first.",
            file=sys.stderr,
        )
        return 2

    engine = create_engine(settings.DATABASE_URL)
    with engine.connect() as connection:
        context = MigrationContext.configure(connection)
        diff = compare_metadata(context, Base.metadata)

    if not diff:
        print("No drift: models match the migrated schema.")
        return 0

    print("Model/migration drift detected:", file=sys.stderr)
    for entry in diff:
        print(f"  - {entry}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Delete telemetry snapshots that fell out of the retention window.

``telemetry_snapshots`` is the highest-volume table in the schema: at a one
second heartbeat each connection writes ~86k rows per day. Raw history is only
needed to draw the equity curve and feed the dashboard, so it is bounded;
``trades`` and account settings are kept indefinitely.

Rows are deleted in batches so a large cleanup never holds a long lock.

Usage (from ``services/api``):

    python scripts/prune_snapshots.py --dry-run
    python scripts/prune_snapshots.py --days 90
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete, func, select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.base import SessionLocal  # noqa: E402
from app.db.models import TelemetrySnapshot  # noqa: E402


def _cutoff(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


def count_expired(db, cutoff: datetime) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(TelemetrySnapshot)
            .where(TelemetrySnapshot.captured_at < cutoff)
        )
        or 0
    )


def prune(days: int, batch_size: int = 5000, dry_run: bool = False) -> int:
    cutoff = _cutoff(days)

    with SessionLocal() as db:
        expired = count_expired(db, cutoff)
        print(f"Cutoff {cutoff.isoformat()} — {expired} snapshot(s) eligible.")

        if dry_run or expired == 0:
            return expired

        deleted = 0
        while True:
            ids = list(
                db.scalars(
                    select(TelemetrySnapshot.id)
                    .where(TelemetrySnapshot.captured_at < cutoff)
                    .limit(batch_size)
                ).all()
            )
            if not ids:
                break
            db.execute(delete(TelemetrySnapshot).where(TelemetrySnapshot.id.in_(ids)))
            db.commit()
            deleted += len(ids)
            print(f"  deleted {deleted}/{expired}")

    print(f"Done. Removed {deleted} snapshot(s).")
    return deleted


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--days",
        type=int,
        default=settings.SNAPSHOT_RETENTION_DAYS,
        help="Retention window in days (default: %(default)s).",
    )
    parser.add_argument("--batch-size", type=int, default=5000)
    parser.add_argument("--dry-run", action="store_true", help="Report without deleting.")
    args = parser.parse_args(argv)

    if args.days < 1:
        parser.error("--days must be at least 1")

    prune(args.days, batch_size=args.batch_size, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

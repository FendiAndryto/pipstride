"""PostgreSQL database backup, verify, and restore utility.

Supports running directly against a local PostgreSQL server or via the
``pipstride_postgres`` Docker container. Output files are standard gzip-compressed
SQL dumps (.sql.gz) containing schema and data.

Usage (from ``services/api`` or repo root):

    # Create backup with 30-day retention pruning
    python scripts/backup_db.py

    # List existing backups
    python scripts/backup_db.py --list

    # Verify a backup file
    python scripts/backup_db.py --verify backups/pipstride_backup_20261024_120000.sql.gz

    # Restore from backup
    python scripts/backup_db.py --restore backups/pipstride_backup_20261024_120000.sql.gz --force
"""

from __future__ import annotations

import argparse
import gzip
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

# Resolve paths relative to services/api
API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]
DEFAULT_BACKUP_DIR = REPO_ROOT / "backups"

CONTAINER_NAME = os.environ.get("POSTGRES_CONTAINER", "pipstride_postgres")


def _parse_db_url(url: str) -> dict[str, str]:
    cleaned = url.replace("postgresql+psycopg://", "postgresql://").replace(
        "postgresql+asyncpg://", "postgresql://"
    )
    parsed = urlparse(cleaned)
    return {
        "user": parsed.username or "pipstride",
        "password": parsed.password or "pipstride_dev_password",
        "host": parsed.hostname or "127.0.0.1",
        "port": str(parsed.port or 5432),
        "db": (parsed.path or "/pipstride").lstrip("/"),
    }


def _get_db_config(cli_url: str | None = None) -> dict[str, str]:
    if cli_url:
        return _parse_db_url(cli_url)
    db_url = os.environ.get("DATABASE_URL")
    if db_url and not db_url.startswith("sqlite"):
        return _parse_db_url(db_url)
    # Check settings if importable
    try:
        sys.path.insert(0, str(API_ROOT))
        from app.core.config import settings

        if settings.DATABASE_URL and not settings.DATABASE_URL.startswith("sqlite"):
            return _parse_db_url(settings.DATABASE_URL)
    except Exception:
        pass
    # Fallback to standard dev defaults
    return {
        "user": os.environ.get("POSTGRES_USER", "pipstride"),
        "password": os.environ.get("POSTGRES_PASSWORD", "pipstride_dev_password"),
        "host": "127.0.0.1",
        "port": os.environ.get("POSTGRES_PORT", "55432"),
        "db": os.environ.get("POSTGRES_DB", "pipstride"),
    }


def _detect_runner() -> str:
    """Return 'host' if pg_dump is available on PATH, 'docker' if container is running."""
    if shutil.which("pg_dump"):
        return "host"
    try:
        res = subprocess.run(
            ["docker", "exec", CONTAINER_NAME, "pg_dump", "--version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if res.returncode == 0:
            return "docker"
    except Exception:
        pass
    return "none"


def format_size(bytes_num: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if bytes_num < 1024.0:
            return f"{bytes_num:3.1f} {unit}"
        bytes_num /= 1024.0
    return f"{bytes_num:.1f} TB"


def backup_database(
    out_dir: Path,
    db_config: dict[str, str],
    keep_days: int = 30,
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    runner = _detect_runner()
    if runner == "none":
        raise RuntimeError(
            "Neither local 'pg_dump' nor Docker container '"
            + CONTAINER_NAME
            + "' is available."
        )

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_file = out_dir / f"pipstride_backup_{timestamp}.sql.gz"

    cmd: list[str]
    env = os.environ.copy()

    if runner == "host":
        cmd = [
            "pg_dump",
            "-h",
            db_config["host"],
            "-p",
            db_config["port"],
            "-U",
            db_config["user"],
            "-d",
            db_config["db"],
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-privileges",
        ]
        env["PGPASSWORD"] = db_config["password"]
    else:
        cmd = [
            "docker",
            "exec",
            "-e",
            f"PGPASSWORD={db_config['password']}",
            CONTAINER_NAME,
            "pg_dump",
            "-U",
            db_config["user"],
            "-d",
            db_config["db"],
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-privileges",
        ]

    print(f"Creating backup with {runner} runner...")
    start_time = time.time()

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )

    with gzip.open(out_file, "wb", compresslevel=9) as gz_out:
        if proc.stdout is None:
            raise RuntimeError("Failed to capture pg_dump stdout")
        shutil.copyfileobj(proc.stdout, gz_out)

    _, stderr = proc.communicate()
    if proc.returncode != 0:
        if out_file.exists():
            out_file.unlink()
        err_msg = stderr.decode(errors="replace").strip() if stderr else "Unknown error"
        raise RuntimeError(f"pg_dump failed with exit code {proc.returncode}: {err_msg}")

    size = out_file.stat().st_size
    if size < 64:
        out_file.unlink()
        raise RuntimeError("Backup produced an empty file.")

    elapsed = time.time() - start_time
    print(f"Backup saved: {out_file.name} ({format_size(size)}) in {elapsed:.2f}s")

    # Prune old backups
    if keep_days > 0:
        prune_backups(out_dir, keep_days)

    return out_file


def verify_backup(backup_path: Path) -> bool:
    if not backup_path.exists():
        print(f"File not found: {backup_path}", file=sys.stderr)
        return False

    try:
        total_uncompressed = 0
        with gzip.open(backup_path, "rb") as gz_in:
            while True:
                chunk = gz_in.read(1024 * 1024)
                if not chunk:
                    break
                total_uncompressed += len(chunk)
        print(
            f"Integrity verified: {backup_path.name} "
            f"(compressed: {format_size(backup_path.stat().st_size)}, "
            f"uncompressed: {format_size(total_uncompressed)})"
        )
        return True
    except Exception as exc:
        print(f"Verification failed: {exc}", file=sys.stderr)
        return False


def prune_backups(out_dir: Path, keep_days: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=keep_days)
    pruned = 0
    for file in out_dir.glob("pipstride_backup_*.sql.gz"):
        mtime = datetime.fromtimestamp(file.stat().st_mtime, tz=timezone.utc)
        if mtime < cutoff:
            file.unlink()
            pruned += 1
            print(f"Pruned old backup: {file.name}")
    return pruned


def list_backups(out_dir: Path) -> None:
    if not out_dir.exists():
        print("No backups directory found.")
        return
    files = sorted(out_dir.glob("pipstride_backup_*.sql.gz"), reverse=True)
    if not files:
        print(f"No backups found in {out_dir}")
        return
    print(f"Backups in {out_dir}:")
    for f in files:
        mtime = datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
        print(f"  {f.name:40} {format_size(f.stat().st_size):>10}  ({mtime})")


def restore_database(
    backup_path: Path,
    db_config: dict[str, str],
    force: bool = False,
) -> bool:
    if not backup_path.exists():
        raise FileNotFoundError(f"Backup file not found: {backup_path}")

    if not verify_backup(backup_path):
        raise RuntimeError("Corrupted backup file; restore aborted.")

    if not force:
        confirm = input(
            f"WARNING: This will overwrite database '{db_config['db']}' on {db_config['host']}.\n"
            f"Type 'RESTORE' to proceed: "
        )
        if confirm.strip() != "RESTORE":
            print("Restore canceled.")
            return False

    runner = _detect_runner()
    if runner == "none":
        raise RuntimeError("Neither psql nor docker is available to execute restore.")

    cmd: list[str]
    env = os.environ.copy()

    if runner == "host":
        cmd = [
            "psql",
            "-h",
            db_config["host"],
            "-p",
            db_config["port"],
            "-U",
            db_config["user"],
            "-d",
            db_config["db"],
        ]
        env["PGPASSWORD"] = db_config["password"]
    else:
        cmd = [
            "docker",
            "exec",
            "-i",
            "-e",
            f"PGPASSWORD={db_config['password']}",
            CONTAINER_NAME,
            "psql",
            "-U",
            db_config["user"],
            "-d",
            db_config["db"],
        ]

    print(f"Restoring {backup_path.name} via {runner}...")
    start_time = time.time()

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )

    with gzip.open(backup_path, "rb") as gz_in:
        if proc.stdin is None:
            raise RuntimeError("Failed to open psql stdin")
        shutil.copyfileobj(gz_in, proc.stdin)
        proc.stdin.close()

    _, stderr = proc.communicate()
    if proc.returncode != 0:
        err_msg = stderr.decode(errors="replace").strip() if stderr else "Unknown error"
        raise RuntimeError(f"Restore failed with exit code {proc.returncode}: {err_msg}")

    print(f"Restore completed successfully in {time.time() - start_time:.2f}s")
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dir",
        type=Path,
        default=DEFAULT_BACKUP_DIR,
        help="Backup destination directory (default: %(default)s)",
    )
    parser.add_argument(
        "--keep-days",
        type=int,
        default=30,
        help="Prune backups older than N days (default: %(default)s)",
    )
    parser.add_argument("--list", action="store_true", help="List available backups")
    parser.add_argument(
        "--verify",
        type=Path,
        metavar="FILE",
        help="Verify the integrity of a backup file",
    )
    parser.add_argument(
        "--restore",
        type=Path,
        metavar="FILE",
        help="Restore a database from a backup file",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Skip confirmation prompt for restore",
    )
    parser.add_argument(
        "--db-url",
        type=str,
        help="Override database connection URL",
    )

    args = parser.parse_args(argv)
    db_config = _get_db_config(args.db_url)

    if args.list:
        list_backups(args.dir)
        return 0

    if args.verify:
        ok = verify_backup(args.verify)
        return 0 if ok else 1

    if args.restore:
        ok = restore_database(args.restore, db_config, force=args.force)
        return 0 if ok else 1

    backup_database(args.dir, db_config, keep_days=args.keep_days)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

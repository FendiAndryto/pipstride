import os
from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


def _engine_kwargs(url: str) -> dict:
    if url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}
    return {
        "pool_pre_ping": True,
        "pool_size": settings.DB_POOL_SIZE,
        "max_overflow": settings.DB_MAX_OVERFLOW,
        "pool_recycle": 1800,
    }


engine = create_engine(settings.DATABASE_URL, **_engine_kwargs(settings.DATABASE_URL))
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope(db: Optional[Session] = None) -> Iterator[Session]:
    """Unit of work: the scope owns the commit, callers never commit.

    Pass an existing request-scoped session to make that session's pending
    changes one transaction; omit it to open (and close) a standalone one.
    """
    session = db if db is not None else SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        if db is None:
            session.close()


def init_db() -> None:
    """Create tables for local development and tests.

    Production relies on Alembic migrations; this is a safety net for
    ephemeral SQLite databases used by the test suite.
    """
    if not settings.DATABASE_URL.startswith("sqlite"):
        return

    from app.db import models  # noqa: F401  (register metadata)

    Base.metadata.create_all(bind=engine)

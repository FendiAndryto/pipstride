#!/bin/sh
# Apply schema migrations, then start the API.
# Alembic is idempotent: running it on every boot is safe.
set -e

if [ -n "$DATABASE_URL" ]; then
    alembic upgrade head
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers

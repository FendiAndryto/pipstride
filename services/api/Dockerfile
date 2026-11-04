# Build context is the repository root so the shared pricing catalog is available.
FROM python:3.12-slim

WORKDIR /repo/services/api

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY services/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# pytest is dev-only; not installed in the production image.

COPY services/api/app/ ./app/
COPY services/api/migrations/ ./migrations/
COPY services/api/scripts/ ./scripts/
COPY services/api/alembic.ini .
COPY services/api/docker-entrypoint.sh .
COPY packages/pricing /repo/packages/pricing

RUN chmod +x docker-entrypoint.sh \
    && adduser --disabled-password --gecos "" --uid 10001 pipstride \
    && chown -R pipstride:pipstride /repo

USER pipstride

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["./docker-entrypoint.sh"]

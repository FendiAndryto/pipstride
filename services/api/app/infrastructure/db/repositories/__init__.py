"""Repositories: thin SQLAlchemy query builders for trade, connection,
telemetry and user access.

These are the queries shared by the HTTP layer and ``core/deps`` (token
resolution). A handful of analytical and membership reads still live in the
service that owns them (``bridge_status_service`` aggregates, ``user_service``
email lookups) — moving them here is a Fase 007 follow-up, not a Fase 005 item.
"""

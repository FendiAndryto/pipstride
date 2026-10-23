"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("username", sa.String(length=64), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False, server_default="trader"),
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "plans",
        sa.Column("code", sa.String(length=32), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("max_connections", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("price_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "mt5_connections",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(length=64), nullable=False, server_default="Akun MT5"),
        sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("token_prefix", sa.String(length=24), nullable=False),
        sa.Column("account_number", sa.BigInteger(), nullable=True),
        sa.Column("broker_server", sa.String(length=128), nullable=True),
        sa.Column("account_currency", sa.String(length=8), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("bound_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_mt5_connections_user_id", "mt5_connections", ["user_id"])
    op.create_index("ix_connections_status", "mt5_connections", ["status"])

    op.create_table(
        "account_settings",
        sa.Column(
            "connection_id",
            sa.String(length=36),
            sa.ForeignKey("mt5_connections.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("custom_initial_deposit", sa.Float(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "telemetry_snapshots",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "connection_id",
            sa.String(length=36),
            sa.ForeignKey("mt5_connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("balance", sa.Float(), nullable=False, server_default="0"),
        sa.Column("equity", sa.Float(), nullable=False, server_default="0"),
        sa.Column("margin", sa.Float(), nullable=False, server_default="0"),
        sa.Column("free_margin", sa.Float(), nullable=False, server_default="0"),
        sa.Column("margin_level", sa.Float(), nullable=False, server_default="0"),
        sa.Column("floating_pnl", sa.Float(), nullable=False, server_default="0"),
        sa.Column("open_positions", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(
        "ix_snapshots_connection_time", "telemetry_snapshots", ["connection_id", "captured_at"]
    )
    op.create_index("ix_telemetry_snapshots_captured_at", "telemetry_snapshots", ["captured_at"])

    op.create_table(
        "trades",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "connection_id",
            sa.String(length=36),
            sa.ForeignKey("mt5_connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ticket", sa.BigInteger(), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("volume", sa.Float(), nullable=False, server_default="0"),
        sa.Column("open_price", sa.Float(), nullable=False, server_default="0"),
        sa.Column("close_price", sa.Float(), nullable=False, server_default="0"),
        sa.Column("profit", sa.Float(), nullable=False, server_default="0"),
        sa.Column("magic", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("connection_id", "ticket", name="uq_trade_connection_ticket"),
    )
    op.create_index("ix_trades_connection_closed", "trades", ["connection_id", "closed_at"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("connection_id", sa.String(length=36), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("detail", sa.String(length=512), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])

    op.create_table(
        "entitlements",
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "plan_code", sa.String(length=32), sa.ForeignKey("plans.code"), nullable=False
        ),
        sa.Column("max_connections", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("entitlements")
    op.drop_table("audit_logs")
    op.drop_table("trades")
    op.drop_table("telemetry_snapshots")
    op.drop_table("account_settings")
    op.drop_table("mt5_connections")
    op.drop_table("plans")
    op.drop_table("users")

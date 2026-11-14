"""cash flow deals

Revision ID: 0005_cash_flow_deals
Revises: 0004_user_expires_at
Create Date: 2026-11-14

Deposits and withdrawals are balance deals, not positions. They are stored in
their own table so the trade table stays position-only and every trading metric
stays correct without a category filter (SPEC-007, ticket 13-02).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_cash_flow_deals"
down_revision: Union[str, None] = "0004_user_expires_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cash_flow_deals",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("connection_id", sa.String(length=36), nullable=False),
        sa.Column("ticket", sa.BigInteger(), nullable=False),
        sa.Column("category", sa.String(length=12), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["connection_id"], ["mt5_connections.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint(
            "connection_id", "ticket", name="uq_cash_flow_connection_ticket"
        ),
    )
    op.create_index(
        "ix_cash_flow_connection_time",
        "cash_flow_deals",
        ["connection_id", "occurred_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_cash_flow_connection_time", table_name="cash_flow_deals")
    op.drop_table("cash_flow_deals")

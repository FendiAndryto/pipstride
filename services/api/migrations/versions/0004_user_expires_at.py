"""user expires at

Revision ID: 0004_user_expires_at
Revises: 0003_support_sessions
Create Date: 2026-11-13

Add nullable expires_at column to users table with index for account expiration
and trial duration management (SPEC-004).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_user_expires_at"
down_revision: Union[str, None] = "0003_support_sessions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_users_expires_at",
        "users",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_users_expires_at", table_name="users")
    op.drop_column("users", "expires_at")

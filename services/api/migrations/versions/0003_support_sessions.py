"""support sessions and audit target dimension

Revision ID: 0003_support_sessions
Revises: 0002_admin_totp
Create Date: 2026-11-12

ADR 0008 §6: support mode is a time-boxed, reason-required elevation recorded in
``support_sessions``. ``audit_logs.target_user_id`` gives the affected user a
queryable dimension for the user-visible access log; ``user_id`` stays the actor.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003_support_sessions"
down_revision: Union[str, None] = "0002_admin_totp"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "support_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("admin_id", sa.String(length=36), nullable=False),
        sa.Column("target_user_id", sa.String(length=36), nullable=False),
        sa.Column("reason", sa.String(length=512), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["admin_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_support_sessions_admin_id", "support_sessions", ["admin_id"], unique=False
    )
    op.create_index(
        "ix_support_sessions_target_user_id",
        "support_sessions",
        ["target_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_support_sessions_admin_target",
        "support_sessions",
        ["admin_id", "target_user_id"],
        unique=False,
    )

    op.add_column(
        "audit_logs", sa.Column("target_user_id", sa.String(length=36), nullable=True)
    )
    op.create_index(
        "ix_audit_logs_target_user_id",
        "audit_logs",
        ["target_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_audit_logs_target_user_id", table_name="audit_logs")
    op.drop_column("audit_logs", "target_user_id")
    op.drop_index("ix_support_sessions_admin_target", table_name="support_sessions")
    op.drop_index("ix_support_sessions_target_user_id", table_name="support_sessions")
    op.drop_index("ix_support_sessions_admin_id", table_name="support_sessions")
    op.drop_table("support_sessions")

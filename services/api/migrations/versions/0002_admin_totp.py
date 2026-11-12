"""admin TOTP enrollment columns

Revision ID: 0002_admin_totp
Revises: aa3be7b45838
Create Date: 2026-11-12

ADR 0008 §5: privileged accounts must present a second factor. ``totp_secret``
holds a fernet-encrypted seed (recoverable, unlike password hashes);
``totp_enrolled_at`` is the switch that unlocks login after verification.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002_admin_totp"
down_revision: Union[str, None] = "aa3be7b45838"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("totp_secret", sa.String(length=512), nullable=True)
    )
    op.add_column(
        "users",
        sa.Column("totp_enrolled_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "totp_enrolled_at")
    op.drop_column("users", "totp_secret")

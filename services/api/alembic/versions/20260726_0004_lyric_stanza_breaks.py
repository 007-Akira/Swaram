"""Preserve lyric stanza breaks.

Revision ID: 20260726_0004
Revises: 20260726_0003
"""

import sqlalchemy as sa
from alembic import op

revision = "20260726_0004"
down_revision = "20260726_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lyric_lines",
        sa.Column("is_stanza_break", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("lyric_lines", "is_stanza_break")

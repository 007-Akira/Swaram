"""Add durable processing stage names.

Revision ID: 20260726_0003
Revises: 20260726_0002
"""

import sqlalchemy as sa
from alembic import op

revision = "20260726_0003"
down_revision = "20260726_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "processing_jobs",
        sa.Column("progress_stage", sa.String(64), server_default="queued", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("processing_jobs", "progress_stage")

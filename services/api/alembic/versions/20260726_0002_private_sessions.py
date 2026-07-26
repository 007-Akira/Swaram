"""Create private session persistence.

Revision ID: 20260726_0002
Revises: 20260726_0001
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260726_0002"
down_revision = "20260726_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    asset_kind = sa.Enum(
        "ORIGINAL_AUDIO",
        "LYRICS",
        "NORMALIZED_AUDIO",
        "VOCALS",
        "INSTRUMENTAL",
        "ANALYSIS",
        "RECORDING",
        name="asset_kind",
    )
    job_state = sa.Enum("QUEUED", "RUNNING", "SUCCEEDED", "FAILED", name="job_state")
    op.create_table(
        "practice_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_practice_sessions_owner_token_hash", "practice_sessions", ["owner_token_hash"]
    )
    op.create_index("ix_practice_sessions_expires_at", "practice_sessions", ["expires_at"])
    op.create_table(
        "uploaded_assets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("practice_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", asset_kind, nullable=False),
        sa.Column("object_key", sa.String(255), nullable=False),
        sa.Column("original_filename", sa.String(255)),
        sa.Column("media_type", sa.String(100), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("checksum_sha256", sa.String(64), nullable=False),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("size_bytes >= 0", name="ck_asset_size_nonnegative"),
        sa.UniqueConstraint("session_id", "object_key", name="uq_asset_session_object"),
    )
    op.create_index("ix_uploaded_assets_session_kind", "uploaded_assets", ["session_id", "kind"])
    op.create_index("ix_uploaded_assets_expires_at", "uploaded_assets", ["expires_at"])
    op.create_table(
        "processing_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("practice_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "asset_id",
            sa.Uuid(),
            sa.ForeignKey("uploaded_assets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("analysis_version", sa.String(32), nullable=False),
        sa.Column("state", job_state, nullable=False),
        sa.Column("progress", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "available_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("claimed_by", sa.String(100)),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True)),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True)),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("failure_code", sa.String(64)),
        sa.Column("failure_detail", postgresql.JSONB()),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("progress BETWEEN 0 AND 100", name="ck_job_progress_range"),
        sa.CheckConstraint("attempt_count >= 0", name="ck_job_attempt_count_nonnegative"),
        sa.UniqueConstraint("asset_id", "analysis_version", name="uq_processing_job_asset_version"),
    )
    op.create_index(
        "ix_processing_jobs_queue", "processing_jobs", ["state", "available_at", "created_at"]
    )
    op.create_index("ix_processing_jobs_lease", "processing_jobs", ["state", "lease_expires_at"])
    op.create_index("ix_processing_jobs_session", "processing_jobs", ["session_id"])
    op.create_table(
        "lyric_documents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("practice_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source_asset_id", sa.Uuid(), sa.ForeignKey("uploaded_assets.id", ondelete="SET NULL")
        ),
        sa.Column("text_nfc", sa.Text(), nullable=False),
        sa.Column("source_format", sa.String(16), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_lyric_documents_session", "lyric_documents", ["session_id"])
    op.create_index("ix_lyric_documents_expires_at", "lyric_documents", ["expires_at"])
    op.create_table(
        "lyric_lines",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "document_id",
            sa.Uuid(),
            sa.ForeignKey("lyric_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("text_nfc", sa.Text(), nullable=False),
        sa.Column("start_ms", sa.Integer()),
        sa.Column("end_ms", sa.Integer()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("position >= 0", name="ck_lyric_line_position_nonnegative"),
        sa.CheckConstraint(
            "end_ms IS NULL OR start_ms IS NULL OR end_ms >= start_ms",
            name="ck_lyric_line_time_order",
        ),
        sa.UniqueConstraint("document_id", "position", name="uq_lyric_line_position"),
    )
    op.create_table(
        "analysis_packages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("practice_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source_asset_id",
            sa.Uuid(),
            sa.ForeignKey("uploaded_assets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("object_key", sa.String(255), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("checksum_sha256", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("source_asset_id", "version", name="uq_analysis_asset_version"),
    )
    op.create_index("ix_analysis_packages_session", "analysis_packages", ["session_id"])
    op.create_index("ix_analysis_packages_expires_at", "analysis_packages", ["expires_at"])
    op.create_table(
        "practice_attempts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("practice_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "analysis_package_id",
            sa.Uuid(),
            sa.ForeignKey("analysis_packages.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "recording_asset_id",
            sa.Uuid(),
            sa.ForeignKey("uploaded_assets.id", ondelete="SET NULL"),
        ),
        sa.Column("score_data", postgresql.JSONB()),
        sa.Column("completion_ratio", sa.Float()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "completion_ratio IS NULL OR completion_ratio BETWEEN 0 AND 1",
            name="ck_attempt_completion_range",
        ),
    )
    op.create_index(
        "ix_practice_attempts_session_created", "practice_attempts", ["session_id", "created_at"]
    )
    op.create_index("ix_practice_attempts_expires_at", "practice_attempts", ["expires_at"])


def downgrade() -> None:
    for table in (
        "practice_attempts",
        "analysis_packages",
        "lyric_lines",
        "lyric_documents",
        "processing_jobs",
        "uploaded_assets",
        "practice_sessions",
    ):
        op.drop_table(table)
    sa.Enum(name="job_state").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="asset_kind").drop(op.get_bind(), checkfirst=True)

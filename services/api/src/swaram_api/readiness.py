from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from swaram_api.models import (
    AnalysisPackage,
    AssetKind,
    LyricDocument,
    PracticeSession,
    UploadedAsset,
)
from swaram_api.storage import ObjectNotFoundError, PrivateStorage


@dataclass(frozen=True)
class ReadinessIssue:
    code: str
    message: str
    action: str


def evaluate_readiness(
    db: Session,
    practice_session: PracticeSession,
    storage: PrivateStorage,
) -> list[ReadinessIssue]:
    issues: list[ReadinessIssue] = []
    analysis = db.scalar(
        select(AnalysisPackage)
        .where(AnalysisPackage.session_id == practice_session.id)
        .order_by(AnalysisPackage.created_at.desc())
        .limit(1)
    )
    if analysis is None:
        issues.append(
            ReadinessIssue(
                "analysis_incomplete",
                "Audio analysis is not complete.",
                "Wait for processing to finish or retry the failed job.",
            )
        )
    document = db.scalar(
        select(LyricDocument)
        .where(LyricDocument.session_id == practice_session.id)
        .options(selectinload(LyricDocument.lines))
        .order_by(LyricDocument.created_at.desc())
        .limit(1)
    )
    lyric_lines = (
        [line for line in document.lines if not line.is_stanza_break and line.text_nfc.strip()]
        if document
        else []
    )
    if not lyric_lines:
        issues.append(
            ReadinessIssue(
                "lyrics_missing",
                "At least one lyric line is required.",
                "Add or import Malayalam lyrics.",
            )
        )
    playback_asset = db.scalar(
        select(UploadedAsset)
        .where(
            UploadedAsset.session_id == practice_session.id,
            UploadedAsset.kind.in_([AssetKind.INSTRUMENTAL, AssetKind.ORIGINAL_AUDIO]),
        )
        .order_by(UploadedAsset.kind.asc(), UploadedAsset.created_at.desc())
        .limit(1)
    )
    duration_ms = playback_asset.duration_ms if playback_asset else None
    previous_end = -1
    for line in lyric_lines:
        if line.start_ms is None or line.end_ms is None:
            issues.append(
                ReadinessIssue(
                    "lyrics_untimed",
                    "Every lyric line needs a start and end time.",
                    "Use tap-to-sync to mark all lyric lines.",
                )
            )
            break
        if (
            line.start_ms < 0
            or line.end_ms <= line.start_ms
            or line.start_ms < previous_end
            or (duration_ms is not None and line.end_ms > duration_ms)
        ):
            issues.append(
                ReadinessIssue(
                    "lyrics_timing_invalid",
                    "Lyric times must be ordered and within the song.",
                    "Adjust the highlighted line markers.",
                )
            )
            break
        previous_end = line.end_ms
    if playback_asset is None:
        issues.append(
            ReadinessIssue(
                "playback_missing",
                "Private playback audio is unavailable.",
                "Upload audio or retry processing.",
            )
        )
    else:
        try:
            storage.stat(practice_session.id, playback_asset.object_key)
        except ObjectNotFoundError:
            issues.append(
                ReadinessIssue(
                    "playback_unavailable",
                    "The private playback object could not be opened.",
                    "Re-upload the audio or retry processing.",
                )
            )
    return issues

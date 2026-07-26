from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import Engine, text
from swaram_contracts import (
    ANALYSIS_VERSION,
    AnalysisPackageV1,
    EnergyPoint,
    PitchRangeMetadata,
    SongSection,
)

from swaram_worker.audio_normalization import (
    AudioProcessingError,
    FFmpegNormalizer,
    IsolatedAudioWorkspace,
)
from swaram_worker.job_queue import ClaimedJob, PostgreSQLJobQueue
from swaram_worker.private_storage import StoredDerivative, WorkerPrivateStorage
from swaram_worker.reference_contour import ContourConfig, extract_contour
from swaram_worker.stem_separation import HTDemucsSeparator
from swaram_worker.timing_analysis import TimingMetadata, analyze_timing

logger = logging.getLogger("swaram.analysis")
PIPELINE_VERSION = ANALYSIS_VERSION


@dataclass(frozen=True)
class JobInput:
    object_key: str
    checksum_sha256: str
    expires_at: datetime


@dataclass(frozen=True)
class StoredOutputs:
    normalized: StoredDerivative
    vocals: StoredDerivative
    instrumental: StoredDerivative
    analysis: StoredDerivative


class AnalysisPipeline:
    def __init__(
        self,
        engine: Engine,
        storage: WorkerPrivateStorage,
        queue: PostgreSQLJobQueue,
        normalizer: FFmpegNormalizer,
        separator: HTDemucsSeparator,
    ) -> None:
        self._engine = engine
        self._storage = storage
        self._queue = queue
        self._normalizer = normalizer
        self._separator = separator

    def _load_input(self, job: ClaimedJob) -> JobInput:
        with self._engine.connect() as connection:
            row = (
                connection.execute(
                    text(
                        """
                    SELECT object_key, checksum_sha256, expires_at
                    FROM uploaded_assets
                    WHERE id = :asset_id AND session_id = :session_id
                        AND kind = 'ORIGINAL_AUDIO'
                    """
                    ),
                    {"asset_id": job.asset_id, "session_id": job.session_id},
                )
                .mappings()
                .one_or_none()
            )
        if row is None:
            raise AudioProcessingError("input_asset_missing", "Input asset is unavailable")
        return JobInput(row["object_key"], row["checksum_sha256"], row["expires_at"])

    def _existing_package(self, job: ClaimedJob) -> UUID | None:
        with self._engine.connect() as connection:
            value = connection.scalar(
                text(
                    """
                    SELECT id FROM analysis_packages
                    WHERE source_asset_id = :asset_id AND version = :version
                    """
                ),
                {"asset_id": job.asset_id, "version": PIPELINE_VERSION},
            )
        return value if isinstance(value, UUID) else None

    def _progress(self, job: ClaimedJob, stage: str, percent: int) -> None:
        if not self._queue.set_progress(job.id, percent, stage):
            raise AudioProcessingError("job_lease_lost", "Processing job lease was lost")

    def _build_package(
        self,
        job: ClaimedJob,
        input_data: JobInput,
        contour: object,
        duration: float,
        timing: TimingMetadata,
        model_identifier: str,
    ) -> AnalysisPackageV1:
        from swaram_worker.reference_contour import ContourExtraction

        if not isinstance(contour, ContourExtraction):
            raise TypeError("contour extraction result is invalid")
        return AnalysisPackageV1(
            session_id=job.session_id,
            generated_at=datetime.now(UTC),
            duration_seconds=duration,
            pitch_frames=contour.browser_frames,
            raw_pitch_frames=contour.raw_debug_frames,
            input_checksum_sha256=input_data.checksum_sha256,
            pipeline_version=PIPELINE_VERSION,
            model_identifier=model_identifier,
            pitch_range=PitchRangeMetadata(
                minimum_frequency_hz=contour.metadata.minimum_frequency_hz,
                maximum_frequency_hz=contour.metadata.maximum_frequency_hz,
            ),
            voiced_coverage=contour.metadata.voiced_coverage,
            estimated_tempo_bpm=timing.estimated_tempo_bpm,
            tempo_confidence=timing.tempo_confidence,
            tempo_limitation=timing.tempo_limitation,
            beat_timestamps_ms=timing.beat_timestamps_ms,
            energy_envelope=[
                EnergyPoint(time_ms=point.time_ms, rms=point.rms)
                for point in timing.energy_envelope
            ],
            sections=[
                SongSection(
                    id=uuid4(),
                    label=section.label,
                    start_seconds=section.start_ms / 1000,
                    end_seconds=section.end_ms / 1000,
                )
                for section in timing.sections
                if section.end_ms > section.start_ms
            ],
        )

    def _persist(
        self,
        job: ClaimedJob,
        input_data: JobInput,
        outputs: StoredOutputs,
    ) -> UUID:
        package_id = uuid4()
        derivative_rows = [
            (uuid4(), "NORMALIZED_AUDIO", outputs.normalized, "audio/wav"),
            (uuid4(), "VOCALS", outputs.vocals, "audio/wav"),
            (uuid4(), "INSTRUMENTAL", outputs.instrumental, "audio/wav"),
        ]
        with self._engine.begin() as connection:
            for asset_id, kind, stored, media_type in derivative_rows:
                connection.execute(
                    text(
                        """
                        INSERT INTO uploaded_assets
                            (id, session_id, kind, object_key, media_type, size_bytes,
                             checksum_sha256, expires_at)
                        VALUES
                            (:id, :session_id, :kind, :object_key, :media_type,
                             :size_bytes, :checksum, :expires_at)
                        """
                    ),
                    {
                        "id": asset_id,
                        "session_id": job.session_id,
                        "kind": kind,
                        "object_key": stored.object_key,
                        "media_type": media_type,
                        "size_bytes": stored.size_bytes,
                        "checksum": stored.checksum_sha256,
                        "expires_at": input_data.expires_at,
                    },
                )
            connection.execute(
                text(
                    """
                    INSERT INTO analysis_packages
                        (id, session_id, source_asset_id, object_key, version,
                         checksum_sha256, expires_at)
                    VALUES
                        (:id, :session_id, :asset_id, :object_key, :version,
                         :checksum, :expires_at)
                    """
                ),
                {
                    "id": package_id,
                    "session_id": job.session_id,
                    "asset_id": job.asset_id,
                    "object_key": outputs.analysis.object_key,
                    "version": PIPELINE_VERSION,
                    "checksum": outputs.analysis.checksum_sha256,
                    "expires_at": input_data.expires_at,
                },
            )
            result = connection.execute(
                text(
                    """
                    UPDATE processing_jobs
                    SET state = 'SUCCEEDED', progress = 100, progress_stage = 'complete',
                        finished_at = CURRENT_TIMESTAMP, lease_expires_at = NULL,
                        heartbeat_at = NULL, updated_at = CURRENT_TIMESTAMP
                    WHERE id = :job_id AND state = 'RUNNING'
                    """
                ),
                {"job_id": job.id},
            )
            if result.rowcount != 1:
                raise AudioProcessingError("job_lease_lost", "Processing job lease was lost")
        return package_id

    def process(self, job: ClaimedJob) -> UUID | None:
        stored_derivatives: list[StoredDerivative] = []

        def remove_partial_outputs() -> None:
            for output in stored_derivatives:
                self._storage.delete(job.session_id, output.object_key)

        try:
            input_data = self._load_input(job)
            existing = self._existing_package(job)
            if existing is not None:
                self._queue.succeed(job.id)
                return existing
            source = self._storage.path_for(job.session_id, input_data.object_key)
            with IsolatedAudioWorkspace() as workspace:
                self._progress(job, "normalizing", 10)
                normalized = self._normalizer.normalize(source, workspace.path)
                stems = self._separator.separate(
                    normalized.playback_wav,
                    workspace.path,
                    lambda stage, percent: self._progress(job, stage, percent),
                )
                self._progress(job, "extracting_contour", 60)
                contour, duration = extract_contour(
                    stems.vocals_wav, ContourConfig(confidence_threshold=0.1)
                )
                self._progress(job, "analyzing_timing", 75)
                timing = analyze_timing(normalized.analysis_wav)
                package = self._build_package(
                    job, input_data, contour, duration, timing, stems.model_id
                )
                package_path = workspace.path / "analysis-package-v1.json"
                package_path.write_text(package.model_dump_json(), encoding="utf-8")
                self._progress(job, "storing_results", 90)
                normalized_stored = self._storage.store_file(
                    job.session_id, normalized.playback_wav
                )
                stored_derivatives.append(normalized_stored)
                vocals_stored = self._storage.store_file(job.session_id, stems.vocals_wav)
                stored_derivatives.append(vocals_stored)
                instrumental_stored = self._storage.store_file(
                    job.session_id, stems.instrumental_wav
                )
                stored_derivatives.append(instrumental_stored)
                analysis_stored = self._storage.store_file(job.session_id, package_path)
                stored_derivatives.append(analysis_stored)
                stored_outputs = StoredOutputs(
                    normalized=normalized_stored,
                    vocals=vocals_stored,
                    instrumental=instrumental_stored,
                    analysis=analysis_stored,
                )
                return self._persist(job, input_data, stored_outputs)
        except AudioProcessingError as error:
            logger.exception("analysis job failed job_id=%s code=%s", job.id, error.code)
            remove_partial_outputs()
            if error.transient and job.attempt_count < 3:
                self._queue.retry(job.id, timedelta(seconds=30 * job.attempt_count))
            else:
                self._queue.fail(job.id, error.code)
            return None
        except Exception:
            logger.exception("analysis job failed unexpectedly job_id=%s", job.id)
            remove_partial_outputs()
            self._queue.fail(job.id, "internal_processing_error")
            return None

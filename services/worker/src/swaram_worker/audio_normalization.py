from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MAX_ERROR_DETAIL = 2000


@dataclass(frozen=True)
class AudioStream:
    codec: str
    channels: int
    sample_rate_hz: int


@dataclass(frozen=True)
class ProbedAudio:
    duration_seconds: float
    format_name: str
    streams: tuple[AudioStream, ...]


@dataclass(frozen=True)
class NormalizedAudio:
    playback_wav: Path
    analysis_wav: Path
    source: ProbedAudio


class AudioProcessingError(Exception):
    def __init__(self, code: str, message: str, *, transient: bool = False) -> None:
        self.code = code
        self.transient = transient
        super().__init__(message)


@dataclass(frozen=True)
class FFmpegLimits:
    maximum_input_bytes: int = 100 * 1024 * 1024
    maximum_duration_seconds: float = 15 * 60
    command_timeout_seconds: float = 120
    playback_sample_rate_hz: int = 44_100
    analysis_sample_rate_hz: int = 22_050
    maximum_decoded_bytes: int = 200 * 1024 * 1024


class IsolatedAudioWorkspace:
    def __init__(self, parent: Path | None = None) -> None:
        self._temporary = tempfile.TemporaryDirectory(prefix="swaram-audio-", dir=parent)
        self.path = Path(self._temporary.name)

    def __enter__(self) -> IsolatedAudioWorkspace:
        return self

    def __exit__(self, *_args: object) -> None:
        self._temporary.cleanup()

    def stage_input(self, source: Path) -> Path:
        destination = self.path / "source.input"
        shutil.copyfile(source, destination)
        return destination


class FFmpegNormalizer:
    def __init__(
        self,
        *,
        ffmpeg_binary: str = "ffmpeg",
        ffprobe_binary: str = "ffprobe",
        limits: FFmpegLimits | None = None,
    ) -> None:
        self._ffmpeg = ffmpeg_binary
        self._ffprobe = ffprobe_binary
        self._limits = limits or FFmpegLimits()

    def _run(self, command: list[str], failure_code: str) -> subprocess.CompletedProcess[str]:
        try:
            result = subprocess.run(
                command,
                shell=False,
                capture_output=True,
                text=True,
                check=False,
                timeout=self._limits.command_timeout_seconds,
            )
        except subprocess.TimeoutExpired as error:
            raise AudioProcessingError(
                "audio_tool_timeout", "Audio processing exceeded its time limit", transient=True
            ) from error
        except OSError as error:
            raise AudioProcessingError(
                "audio_tool_unavailable", "Required audio tooling is unavailable"
            ) from error
        if result.returncode != 0:
            detail = result.stderr.strip()[-MAX_ERROR_DETAIL:]
            message = f"Audio processing failed: {detail}" if detail else "Audio processing failed"
            raise AudioProcessingError(failure_code, message)
        return result

    def probe(self, source: Path) -> ProbedAudio:
        try:
            size = source.stat().st_size
        except OSError as error:
            raise AudioProcessingError("input_unavailable", "Input audio is unavailable") from error
        if size <= 0:
            raise AudioProcessingError("empty_audio", "Input audio is empty")
        if size > self._limits.maximum_input_bytes:
            raise AudioProcessingError("audio_too_large", "Input audio exceeds its size limit")
        result = self._run(
            [
                self._ffprobe,
                "-v",
                "error",
                "-protocol_whitelist",
                "file,crypto,data",
                "-show_entries",
                "format=format_name,duration",
                "-show_entries",
                "stream=codec_type,codec_name,channels,sample_rate",
                "-of",
                "json",
                str(source),
            ],
            "audio_probe_failed",
        )
        try:
            payload: dict[str, Any] = json.loads(result.stdout)
            format_data = payload["format"]
            duration = float(format_data["duration"])
            format_name = str(format_data["format_name"])
            streams = tuple(
                AudioStream(
                    codec=str(stream["codec_name"]),
                    channels=int(stream["channels"]),
                    sample_rate_hz=int(stream["sample_rate"]),
                )
                for stream in payload["streams"]
                if stream.get("codec_type") == "audio"
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise AudioProcessingError(
                "invalid_audio_metadata", "Audio metadata is incomplete"
            ) from error
        if not streams:
            raise AudioProcessingError("no_audio_stream", "Input contains no audio stream")
        if duration <= 0:
            raise AudioProcessingError("invalid_audio_duration", "Audio duration is invalid")
        if duration > self._limits.maximum_duration_seconds:
            raise AudioProcessingError("audio_too_long", "Input audio exceeds its duration limit")
        return ProbedAudio(duration, format_name, streams)

    def normalize(self, source: Path, workspace: Path) -> NormalizedAudio:
        workspace = workspace.resolve()
        if not workspace.is_dir():
            raise AudioProcessingError("workspace_unavailable", "Audio workspace is unavailable")
        probe = self.probe(source)
        playback = workspace / "normalized_playback.wav"
        analysis = workspace / "analysis_mono.wav"
        common = [
            self._ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-protocol_whitelist",
            "file,crypto,data",
            "-threads",
            "1",
            "-i",
            str(source),
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-c:a",
            "pcm_s16le",
        ]
        self._run(
            [
                *common,
                "-ac",
                "2",
                "-ar",
                str(self._limits.playback_sample_rate_hz),
                "-y",
                str(playback),
            ],
            "audio_decode_failed",
        )
        self._run(
            [
                *common,
                "-ac",
                "1",
                "-ar",
                str(self._limits.analysis_sample_rate_hz),
                "-y",
                str(analysis),
            ],
            "audio_decode_failed",
        )
        decoded_size = playback.stat().st_size + analysis.stat().st_size
        if decoded_size > self._limits.maximum_decoded_bytes:
            playback.unlink(missing_ok=True)
            analysis.unlink(missing_ok=True)
            raise AudioProcessingError(
                "decoded_audio_too_large",
                "Decoded audio exceeds its resource limit",
            )
        return NormalizedAudio(playback, analysis, probe)

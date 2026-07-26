import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class AudioValidationError(Exception):
    pass


@dataclass(frozen=True)
class AudioMetadata:
    media_type: str
    duration_ms: int


FORMAT_MEDIA_TYPES = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "flac": "audio/flac",
    "mov,mp4,m4a,3gp,3g2,mj2": "audio/mp4",
}


def inspect_audio(path: Path, ffprobe_binary: str, max_duration_seconds: int) -> AudioMetadata:
    try:
        result = subprocess.run(
            [
                ffprobe_binary,
                "-v",
                "error",
                "-show_entries",
                "format=format_name,duration",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            check=False,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise AudioValidationError("audio validation is unavailable") from error
    if result.returncode != 0:
        raise AudioValidationError("file is not decodable audio")
    try:
        payload: dict[str, Any] = json.loads(result.stdout)
        format_data = payload["format"]
        format_name = str(format_data["format_name"])
        duration = float(format_data["duration"])
        streams = payload["streams"]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise AudioValidationError("audio metadata is invalid") from error
    if not any(stream.get("codec_type") == "audio" for stream in streams):
        raise AudioValidationError("file contains no audio stream")
    media_type = FORMAT_MEDIA_TYPES.get(format_name)
    if media_type is None:
        raise AudioValidationError("audio format must be MP3, WAV, M4A, or FLAC")
    if duration <= 0 or duration > max_duration_seconds:
        raise AudioValidationError("audio duration exceeds the configured limit")
    return AudioMetadata(media_type=media_type, duration_ms=round(duration * 1000))

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
ALLOWED_EXTENSIONS = {
    "audio/flac": {".flac"},
    "audio/mp4": {".m4a", ".mp4"},
    "audio/mpeg": {".mp3"},
    "audio/wav": {".wav", ".wave"},
}
ALLOWED_DECLARED_TYPES = {
    "audio/flac": {"audio/flac", "audio/x-flac"},
    "audio/mp4": {"audio/mp4", "audio/m4a", "audio/x-m4a"},
    "audio/mpeg": {"audio/mpeg", "audio/mp3"},
    "audio/wav": {"audio/wav", "audio/wave", "audio/x-wav"},
}


def inspect_audio(
    path: Path,
    ffprobe_binary: str,
    max_duration_seconds: int,
    max_decoded_bytes: int,
) -> AudioMetadata:
    try:
        result = subprocess.run(
            [
                ffprobe_binary,
                "-v",
                "error",
                "-protocol_whitelist",
                "file,crypto,data",
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
    estimated_decoded_bytes = duration * 44_100 * 2 * 2
    if estimated_decoded_bytes > max_decoded_bytes:
        raise AudioValidationError("decoded audio exceeds the configured limit")
    return AudioMetadata(media_type=media_type, duration_ms=round(duration * 1000))


def validate_upload_identity(filename: str, declared_type: str, detected_type: str) -> None:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS[detected_type]:
        raise AudioValidationError("filename extension does not match decoded audio")
    normalized_type = declared_type.lower().split(";", maxsplit=1)[0].strip()
    if normalized_type not in ALLOWED_DECLARED_TYPES[detected_type]:
        raise AudioValidationError("declared MIME type does not match decoded audio")

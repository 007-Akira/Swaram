from dataclasses import dataclass
from pathlib import Path


class AudioValidationError(Exception):
    pass


@dataclass(frozen=True)
class AudioMetadata:
    media_type: str
    duration_ms: int | None = None


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
MP4_BRANDS = {b"M4A ", b"isom", b"mp41", b"mp42", b"qt  "}


def inspect_audio(path: Path) -> AudioMetadata:
    try:
        with path.open("rb") as source:
            header = source.read(32)
    except OSError as error:
        raise AudioValidationError("audio validation is unavailable") from error
    if header.startswith(b"fLaC"):
        return AudioMetadata(media_type="audio/flac")
    if len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WAVE":
        return AudioMetadata(media_type="audio/wav")
    if header.startswith(b"ID3") or (
        len(header) >= 2 and header[0] == 0xFF and header[1] & 0xE0 == 0xE0
    ):
        return AudioMetadata(media_type="audio/mpeg")
    if len(header) >= 12 and header[4:8] == b"ftyp" and header[8:12] in MP4_BRANDS:
        return AudioMetadata(media_type="audio/mp4")
    raise AudioValidationError("file signature is not MP3, WAV, M4A, or FLAC")


def validate_upload_identity(filename: str, declared_type: str, detected_type: str) -> None:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS[detected_type]:
        raise AudioValidationError("filename extension does not match audio signature")
    normalized_type = declared_type.lower().split(";", maxsplit=1)[0].strip()
    if normalized_type not in ALLOWED_DECLARED_TYPES[detected_type]:
        raise AudioValidationError("declared MIME type does not match audio signature")

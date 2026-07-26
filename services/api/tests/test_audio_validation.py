import pytest
from swaram_api.audio_validation import AudioValidationError, inspect_audio


@pytest.mark.parametrize(
    ("content", "media_type"),
    [
        (b"fLaC" + b"\0" * 28, "audio/flac"),
        (b"RIFF" + b"\0" * 4 + b"WAVE" + b"\0" * 20, "audio/wav"),
        (b"ID3" + b"\0" * 29, "audio/mpeg"),
        (b"\0\0\0\x18ftypM4A " + b"\0" * 20, "audio/mp4"),
    ],
)
def test_magic_byte_screen_accepts_supported_audio(tmp_path, content, media_type) -> None:
    path = tmp_path / "upload"
    path.write_bytes(content)
    assert inspect_audio(path).media_type == media_type


def test_magic_byte_screen_rejects_unrecognized_content(tmp_path) -> None:
    path = tmp_path / "upload"
    path.write_bytes(b"<script>alert(1)</script>")
    with pytest.raises(AudioValidationError, match="file signature"):
        inspect_audio(path)

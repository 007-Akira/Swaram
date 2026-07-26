import json
import unicodedata
from dataclasses import asdict

import pytest
from swaram_api.lyric_parser import LyricParseError, decode_lyrics, parse_lyrics

MALAYALAM_LINES = "ദൂരെ ഒരു മഴവില്ല്…\n\nകൺമണി, നീ വരുമോ?\nകൺമണി, നീ വരുമോ?"


def test_plain_text_preserves_chillu_punctuation_stanzas_and_repetition() -> None:
    decomposed = unicodedata.normalize("NFD", MALAYALAM_LINES)
    lines = parse_lyrics(decomposed, "txt")
    assert [line.text_nfc for line in lines] == [
        "ദൂരെ ഒരു മഴവില്ല്…",
        "",
        "കൺമണി, നീ വരുമോ?",
        "കൺമണി, നീ വരുമോ?",
    ]
    assert lines[1].is_stanza_break is True
    assert all(unicodedata.is_normalized("NFC", line.text_nfc) for line in lines)
    assert "ൺ" in lines[2].text_nfc


def test_lrc_converts_fractional_times_to_integer_milliseconds() -> None:
    lrc = "[ar:സ്വകാര്യ ഗാനം]\n[00:34.73]ദൂരെ ഒരു മഴവില്ല്\n[00:39.850]കൺമണി\n[00:45]കൺമണി\n"
    lines = parse_lyrics(lrc, "lrc")
    assert [(line.start_ms, line.end_ms) for line in lines] == [
        (34_730, 39_850),
        (39_850, 45_000),
        (45_000, None),
    ]
    assert lines[1].text_nfc == lines[2].text_nfc


def test_srt_parses_multiline_cues_and_rejects_overlap() -> None:
    srt = (
        "1\n00:00:01,250 --> 00:00:03,000\nആദ്യ വരി\nതുടർച്ച\n\n"
        "2\n00:00:03.000 --> 00:00:04.500\nരണ്ടാം വരി\n"
    )
    lines = parse_lyrics(srt, "srt")
    assert asdict(lines[0]) == {
        "text_nfc": "ആദ്യ വരി\nതുടർച്ച",
        "start_ms": 1250,
        "end_ms": 3000,
        "is_stanza_break": False,
    }
    overlapping = srt.replace("00:00:03.000 -->", "00:00:02.900 -->")
    with pytest.raises(LyricParseError) as captured:
        parse_lyrics(overlapping, "srt")
    assert captured.value.code == "overlapping_lyrics"


@pytest.mark.parametrize("content", [b"\xff\xfe\x00a", b"valid\x00binary"])
def test_invalid_or_binary_files_have_clear_codes(content: bytes) -> None:
    with pytest.raises(LyricParseError) as captured:
        decode_lyrics(content)
    assert captured.value.code in {"invalid_utf8", "binary_lyrics"}


@pytest.mark.parametrize("source_format", ["txt", "lrc", "srt"])
def test_parsed_lines_round_trip_as_utf8_json(source_format: str) -> None:
    inputs = {
        "txt": "മഴവില്ല്\n\nകൺമണി",
        "lrc": "[00:01.00]മഴവില്ല്\n[00:02.00]കൺമണി",
        "srt": "1\n00:00:01,000 --> 00:00:02,000\nമഴവില്ല്",
    }
    lines = parse_lyrics(inputs[source_format], source_format)  # type: ignore[arg-type]
    encoded = json.dumps([asdict(line) for line in lines], ensure_ascii=False).encode()
    restored = json.loads(encoded.decode())
    assert restored[0]["text_nfc"] == "മഴവില്ല്"

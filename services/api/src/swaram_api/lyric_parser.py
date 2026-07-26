from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

LyricFormat = Literal["txt", "lrc", "srt"]
LRC_LINE = re.compile(r"^(?P<timestamps>(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)(?P<text>.*)$")
LRC_TIMESTAMP = re.compile(
    r"\[(?P<minutes>\d{1,3}):(?P<seconds>\d{2})(?:[.:](?P<fraction>\d{1,3}))?\]"
)
SRT_TIMING = re.compile(
    r"^(?P<start>\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+"
    r"(?P<end>\d{2}:\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$"
)


class LyricParseError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class ParsedLyricLine:
    text_nfc: str
    start_ms: int | None = None
    end_ms: int | None = None
    is_stanza_break: bool = False


def decode_lyrics(raw: bytes) -> str:
    if b"\x00" in raw:
        raise LyricParseError("binary_lyrics", "Lyrics file appears to contain binary data")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise LyricParseError("invalid_utf8", "Lyrics must be valid UTF-8") from error
    return unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")


def _fraction_ms(value: str | None) -> int:
    if value is None:
        return 0
    if len(value) == 1:
        return int(value) * 100
    if len(value) == 2:
        return int(value) * 10
    return int(value)


def _lrc_time(match: re.Match[str]) -> int:
    seconds = int(match.group("seconds"))
    if seconds >= 60:
        raise LyricParseError("invalid_lrc_time", "LRC seconds must be below 60")
    return (
        int(match.group("minutes")) * 60_000
        + seconds * 1000
        + _fraction_ms(match.group("fraction"))
    )


def _srt_time(value: str) -> int:
    hours, minutes, rest = value.replace(".", ",").split(":")
    seconds, milliseconds = rest.split(",")
    if int(minutes) >= 60 or int(seconds) >= 60:
        raise LyricParseError("invalid_srt_time", "SRT minutes and seconds must be below 60")
    return int(hours) * 3_600_000 + int(minutes) * 60_000 + int(seconds) * 1000 + int(milliseconds)


def _validate(lines: list[ParsedLyricLine]) -> list[ParsedLyricLine]:
    timed = [line for line in lines if line.start_ms is not None]
    previous_end = -1
    for line in timed:
        assert line.start_ms is not None
        if line.start_ms < 0 or (line.end_ms is not None and line.end_ms <= line.start_ms):
            raise LyricParseError(
                "invalid_lyric_time", "Lyric timestamps must have positive duration"
            )
        if line.start_ms < previous_end:
            raise LyricParseError(
                "overlapping_lyrics", "Lyric timestamps must be ordered and non-overlapping"
            )
        previous_end = line.end_ms if line.end_ms is not None else line.start_ms
    return lines


def parse_plain_text(text: str) -> list[ParsedLyricLine]:
    normalized = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    lines = [
        ParsedLyricLine(
            text_nfc=line,
            is_stanza_break=not line.strip(),
        )
        for line in normalized.split("\n")
    ]
    while lines and lines[-1].is_stanza_break:
        lines.pop()
    if not any(not line.is_stanza_break for line in lines):
        raise LyricParseError("empty_lyrics", "Lyrics are empty")
    return lines


def parse_lrc(text: str) -> list[ParsedLyricLine]:
    parsed: list[tuple[int, str]] = []
    for raw_line in unicodedata.normalize("NFC", text).splitlines():
        if not raw_line.strip():
            continue
        match = LRC_LINE.match(raw_line)
        if match is None:
            if re.match(r"^\[[A-Za-z]+:", raw_line):
                continue
            raise LyricParseError("invalid_lrc", "Every LRC lyric line needs a timestamp")
        lyric_text = match.group("text")
        if not lyric_text:
            raise LyricParseError("empty_lyric_line", "Timed lyric lines cannot be empty")
        for timestamp in LRC_TIMESTAMP.finditer(match.group("timestamps")):
            parsed.append((_lrc_time(timestamp), lyric_text))
    if not parsed:
        raise LyricParseError("empty_lyrics", "LRC contains no timed lyric lines")
    parsed.sort(key=lambda item: item[0])
    lines = [
        ParsedLyricLine(
            text_nfc=text_value,
            start_ms=start,
            end_ms=parsed[index + 1][0] if index + 1 < len(parsed) else None,
        )
        for index, (start, text_value) in enumerate(parsed)
    ]
    return _validate(lines)


def parse_srt(text: str) -> list[ParsedLyricLine]:
    normalized = unicodedata.normalize("NFC", text).replace("\r\n", "\n").strip()
    cues: list[ParsedLyricLine] = []
    for block in re.split(r"\n\s*\n", normalized):
        rows = block.splitlines()
        if rows and rows[0].strip().isdigit():
            rows = rows[1:]
        if len(rows) < 2:
            raise LyricParseError("invalid_srt", "SRT cue is incomplete")
        timing = SRT_TIMING.match(rows[0].strip())
        if timing is None:
            raise LyricParseError("invalid_srt", "SRT cue timestamp is invalid")
        lyric_text = "\n".join(rows[1:])
        if not lyric_text.strip():
            raise LyricParseError("empty_lyric_line", "Timed lyric lines cannot be empty")
        cues.append(
            ParsedLyricLine(
                text_nfc=lyric_text,
                start_ms=_srt_time(timing.group("start")),
                end_ms=_srt_time(timing.group("end")),
            )
        )
    if not cues:
        raise LyricParseError("empty_lyrics", "SRT contains no lyric cues")
    return _validate(cues)


def parse_lyrics(text: str, source_format: LyricFormat) -> list[ParsedLyricLine]:
    if "\x00" in text:
        raise LyricParseError("binary_lyrics", "Lyrics appear to contain binary data")
    if source_format == "lrc":
        return parse_lrc(text)
    if source_format == "srt":
        return parse_srt(text)
    return parse_plain_text(text)

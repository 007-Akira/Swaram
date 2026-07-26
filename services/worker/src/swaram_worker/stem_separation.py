from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from swaram_worker.audio_normalization import MAX_ERROR_DETAIL, AudioProcessingError

MODEL_ID = "htdemucs"
DEMUCS_VERSION = "4.0.1"
TORCH_VERSION = "2.7.1"
Device = Literal["auto", "cpu", "cuda", "mps"]
ProgressCallback = Callable[[str, int], None]


@dataclass(frozen=True)
class SeparatedStems:
    vocals_wav: Path
    instrumental_wav: Path
    model_id: str
    device: str


class HTDemucsSeparator:
    def __init__(
        self,
        *,
        device: Device = "cpu",
        command_timeout_seconds: float = 30 * 60,
        python_binary: str = sys.executable,
    ) -> None:
        if device not in {"auto", "cpu", "cuda", "mps"}:
            raise ValueError("device must be auto, cpu, cuda, or mps")
        self._device = device
        self._timeout = command_timeout_seconds
        self._python = python_binary

    def separate(
        self,
        normalized_playback: Path,
        workspace: Path,
        progress: ProgressCallback = lambda _stage, _percent: None,
    ) -> SeparatedStems:
        workspace = workspace.resolve()
        if not workspace.is_dir():
            raise AudioProcessingError("workspace_unavailable", "Stem workspace is unavailable")
        vocals_destination = workspace / "vocals.wav"
        instrumental_destination = workspace / "instrumental.wav"
        progress("stem_separation_preparing", 25)
        with tempfile.TemporaryDirectory(prefix="demucs-", dir=workspace) as temporary:
            temporary_path = Path(temporary)
            staged_input = temporary_path / "normalized.wav"
            shutil.copyfile(normalized_playback, staged_input)
            output_root = temporary_path / "output"
            command = [
                self._python,
                "-m",
                "demucs.separate",
                "--name",
                MODEL_ID,
                "--two-stems",
                "vocals",
                "--device",
                self._device,
                "--out",
                str(output_root),
                str(staged_input),
            ]
            progress("stem_separation_running", 30)
            try:
                result = subprocess.run(
                    command,
                    shell=False,
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=self._timeout,
                )
            except subprocess.TimeoutExpired as error:
                raise AudioProcessingError(
                    "stem_separation_timeout",
                    "Stem separation exceeded its time limit",
                    transient=True,
                ) from error
            except OSError as error:
                raise AudioProcessingError(
                    "stem_separator_unavailable", "Stem separation tooling is unavailable"
                ) from error
            if result.returncode != 0:
                detail = result.stderr.strip()[-MAX_ERROR_DETAIL:]
                raise AudioProcessingError(
                    "stem_separation_failed",
                    f"Stem separation failed: {detail}" if detail else "Stem separation failed",
                )
            stem_directory = output_root / MODEL_ID / staged_input.stem
            vocals_source = stem_directory / "vocals.wav"
            instrumental_source = stem_directory / "no_vocals.wav"
            if not vocals_source.is_file() or not instrumental_source.is_file():
                raise AudioProcessingError(
                    "stem_output_missing", "Stem separator produced incomplete output"
                )
            shutil.copyfile(vocals_source, vocals_destination)
            shutil.copyfile(instrumental_source, instrumental_destination)
        progress("stem_separation_complete", 55)
        return SeparatedStems(
            vocals_wav=vocals_destination,
            instrumental_wav=instrumental_destination,
            model_id=MODEL_ID,
            device=self._device,
        )

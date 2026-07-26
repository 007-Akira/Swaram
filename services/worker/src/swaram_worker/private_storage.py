from __future__ import annotations

import hashlib
import os
import secrets
import shutil
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from uuid import UUID


@dataclass(frozen=True)
class StoredDerivative:
    object_key: str
    size_bytes: int
    checksum_sha256: str


class WorkerPrivateStorage:
    def __init__(self, data_root: Path) -> None:
        self._root = (data_root / "private").resolve()
        self._root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def _session_directory(self, session_id: UUID) -> Path:
        directory = (self._root / str(session_id)).resolve()
        if directory.parent != self._root:
            raise ValueError("invalid session identifier")
        return directory

    def path_for(self, session_id: UUID, object_key: str) -> Path:
        key = PurePosixPath(object_key)
        if (
            not object_key
            or key.is_absolute()
            or len(key.parts) != 1
            or key.parts[0] in {".", ".."}
            or "\\" in object_key
        ):
            raise ValueError("invalid private object key")
        directory = self._session_directory(session_id)
        path = (directory / key.parts[0]).resolve()
        if path.parent != directory or not path.is_file():
            raise FileNotFoundError("private object is unavailable")
        return path

    def store_file(self, session_id: UUID, source: Path) -> StoredDerivative:
        directory = self._session_directory(session_id)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        key = secrets.token_urlsafe(32)
        destination = directory / key
        digest = hashlib.sha256()
        with source.open("rb") as input_file, destination.open("xb") as output_file:
            os.chmod(destination, 0o600)
            while chunk := input_file.read(64 * 1024):
                digest.update(chunk)
                output_file.write(chunk)
        return StoredDerivative(key, destination.stat().st_size, digest.hexdigest())

    def delete(self, session_id: UUID, object_key: str) -> None:
        with suppress(FileNotFoundError):
            self.path_for(session_id, object_key).unlink()

    def delete_session(self, session_id: UUID) -> None:
        shutil.rmtree(self._session_directory(session_id), ignore_errors=True)

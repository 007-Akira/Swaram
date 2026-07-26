from __future__ import annotations

import hashlib
import os
import secrets
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Protocol
from uuid import UUID

CHUNK_SIZE = 64 * 1024


class StorageError(Exception):
    """Base exception safe to translate at the API boundary."""


class ObjectNotFoundError(StorageError):
    pass


class InvalidObjectKeyError(StorageError):
    pass


@dataclass(frozen=True)
class StoredObject:
    object_key: str
    size_bytes: int
    checksum_sha256: str


@dataclass(frozen=True)
class ObjectStat:
    size_bytes: int


class PrivateStorage(Protocol):
    def store(self, session_id: UUID, source: BinaryIO) -> StoredObject: ...

    def stat(self, session_id: UUID, object_key: str) -> ObjectStat: ...

    @contextmanager
    def open(self, session_id: UUID, object_key: str) -> Iterator[BinaryIO]: ...

    def delete(self, session_id: UUID, object_key: str) -> bool: ...

    def delete_session(self, session_id: UUID) -> bool: ...


class LocalPrivateStorage:
    """Private local storage. Object keys are opaque and always session scoped."""

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()
        self._root.mkdir(mode=0o700, parents=True, exist_ok=True)

    @staticmethod
    def _validate_key(object_key: str) -> str:
        path = PurePosixPath(object_key)
        if (
            not object_key
            or path.is_absolute()
            or len(path.parts) != 1
            or path.parts[0] in {".", ".."}
            or "\\" in object_key
        ):
            raise InvalidObjectKeyError("invalid object key")
        return path.parts[0]

    def _session_directory(self, session_id: UUID) -> Path:
        candidate = (self._root / str(session_id)).resolve()
        if candidate.parent != self._root:
            raise InvalidObjectKeyError("invalid session identifier")
        return candidate

    def _path(self, session_id: UUID, object_key: str) -> Path:
        key = self._validate_key(object_key)
        directory = self._session_directory(session_id)
        candidate = (directory / key).resolve()
        if candidate.parent != directory:
            raise InvalidObjectKeyError("object escapes session storage")
        return candidate

    def store(self, session_id: UUID, source: BinaryIO) -> StoredObject:
        directory = self._session_directory(session_id)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        object_key = secrets.token_urlsafe(32)
        destination = self._path(session_id, object_key)
        digest = hashlib.sha256()
        size = 0
        descriptor, temporary_name = tempfile.mkstemp(prefix=".upload-", dir=directory)
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "wb") as target:
                while chunk := source.read(CHUNK_SIZE):
                    digest.update(chunk)
                    size += len(chunk)
                    target.write(chunk)
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary_name, destination)
        except BaseException:
            Path(temporary_name).unlink(missing_ok=True)
            raise
        return StoredObject(object_key, size, digest.hexdigest())

    def stat(self, session_id: UUID, object_key: str) -> ObjectStat:
        path = self._path(session_id, object_key)
        try:
            metadata = path.stat()
        except FileNotFoundError as error:
            raise ObjectNotFoundError("private object not found") from error
        if not path.is_file():
            raise ObjectNotFoundError("private object not found")
        return ObjectStat(size_bytes=metadata.st_size)

    @contextmanager
    def open(self, session_id: UUID, object_key: str) -> Iterator[BinaryIO]:
        path = self._path(session_id, object_key)
        try:
            handle = path.open("rb")
        except FileNotFoundError as error:
            raise ObjectNotFoundError("private object not found") from error
        try:
            yield handle
        finally:
            handle.close()

    def delete(self, session_id: UUID, object_key: str) -> bool:
        path = self._path(session_id, object_key)
        try:
            path.unlink()
        except FileNotFoundError:
            return False
        directory = self._session_directory(session_id)
        with suppress(OSError):
            directory.rmdir()
        return True

    def delete_session(self, session_id: UUID) -> bool:
        directory = self._session_directory(session_id)
        if not directory.exists():
            return False
        shutil.rmtree(directory)
        return True


@dataclass(frozen=True)
class ByteRange:
    start: int
    end: int
    total: int

    @property
    def length(self) -> int:
        return self.end - self.start + 1

    @property
    def content_range(self) -> str:
        return f"bytes {self.start}-{self.end}/{self.total}"


def parse_range_header(value: str | None, size: int) -> ByteRange:
    if size <= 0:
        raise ValueError("cannot range an empty object")
    if value is None:
        return ByteRange(0, size - 1, size)
    if not value.startswith("bytes=") or "," in value:
        raise ValueError("only one byte range is supported")
    bounds = value[6:].split("-", maxsplit=1)
    if len(bounds) != 2:
        raise ValueError("invalid byte range")
    start_text, end_text = bounds
    try:
        if not start_text:
            suffix_length = int(end_text)
            if suffix_length <= 0:
                raise ValueError
            start = max(0, size - suffix_length)
            end = size - 1
        else:
            start = int(start_text)
            end = size - 1 if not end_text else int(end_text)
    except ValueError as error:
        raise ValueError("invalid byte range") from error
    if start < 0 or end < start or start >= size:
        raise ValueError("unsatisfiable byte range")
    return ByteRange(start, min(end, size - 1), size)


def iter_object_range(
    storage: PrivateStorage, session_id: UUID, object_key: str, byte_range: ByteRange
) -> Iterator[bytes]:
    remaining = byte_range.length
    with storage.open(session_id, object_key) as source:
        source.seek(byte_range.start)
        while remaining:
            chunk = source.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk

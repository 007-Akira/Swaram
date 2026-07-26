from io import BytesIO
from uuid import uuid4

import pytest
from swaram_api.storage import (
    InvalidObjectKeyError,
    LocalPrivateStorage,
    ObjectNotFoundError,
    iter_object_range,
    parse_range_header,
)


def test_store_stat_open_and_delete_are_session_scoped(tmp_path) -> None:
    storage = LocalPrivateStorage(tmp_path)
    owner_session = uuid4()
    other_session = uuid4()
    stored = storage.store(owner_session, BytesIO(b"private audio"))

    assert "/" not in stored.object_key
    assert stored.size_bytes == 13
    assert storage.stat(owner_session, stored.object_key).size_bytes == 13
    with storage.open(owner_session, stored.object_key) as source:
        assert source.read() == b"private audio"
    with pytest.raises(ObjectNotFoundError):
        storage.open(other_session, stored.object_key).__enter__()
    assert storage.delete(other_session, stored.object_key) is False
    assert storage.delete(owner_session, stored.object_key) is True
    assert storage.delete(owner_session, stored.object_key) is False


@pytest.mark.parametrize("key", ["../secret", "/etc/passwd", "a/b", r"a\b", ".", "..", ""])
def test_path_traversal_keys_are_rejected(tmp_path, key: str) -> None:
    storage = LocalPrivateStorage(tmp_path)
    with pytest.raises(InvalidObjectKeyError):
        storage.stat(uuid4(), key)


def test_delete_session_is_recursive_and_idempotent(tmp_path) -> None:
    storage = LocalPrivateStorage(tmp_path)
    session_id = uuid4()
    storage.store(session_id, BytesIO(b"one"))
    storage.store(session_id, BytesIO(b"two"))
    assert storage.delete_session(session_id) is True
    assert storage.delete_session(session_id) is False


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, (0, 9)),
        ("bytes=2-5", (2, 5)),
        ("bytes=7-", (7, 9)),
        ("bytes=-3", (7, 9)),
        ("bytes=7-99", (7, 9)),
    ],
)
def test_range_parsing_and_streaming(
    tmp_path, header: str | None, expected: tuple[int, int]
) -> None:
    storage = LocalPrivateStorage(tmp_path)
    session_id = uuid4()
    stored = storage.store(session_id, BytesIO(b"0123456789"))
    byte_range = parse_range_header(header, 10)
    assert (byte_range.start, byte_range.end) == expected
    assert (
        b"".join(iter_object_range(storage, session_id, stored.object_key, byte_range))
        == (b"0123456789"[expected[0] : expected[1] + 1])
    )


@pytest.mark.parametrize(
    "header", ["items=0-2", "bytes=2-1", "bytes=10-", "bytes=a-b", "bytes=0-1,3-4"]
)
def test_invalid_ranges_are_rejected(header: str) -> None:
    with pytest.raises(ValueError):
        parse_range_header(header, 10)

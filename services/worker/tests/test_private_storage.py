from uuid import uuid4

import pytest
from swaram_worker.private_storage import WorkerPrivateStorage


def test_worker_storage_matches_private_session_layout(tmp_path) -> None:
    storage = WorkerPrivateStorage(tmp_path)
    session_id = uuid4()
    source = tmp_path / "result.json"
    source.write_text('{"private":true}', encoding="utf-8")
    stored = storage.store_file(session_id, source)
    assert "/" not in stored.object_key
    assert storage.path_for(session_id, stored.object_key).read_bytes() == source.read_bytes()
    storage.delete(session_id, stored.object_key)
    with pytest.raises(FileNotFoundError):
        storage.path_for(session_id, stored.object_key)


@pytest.mark.parametrize("key", ["../file", "/etc/passwd", "nested/file", r"nested\file"])
def test_worker_storage_rejects_path_traversal(tmp_path, key: str) -> None:
    with pytest.raises(ValueError):
        WorkerPrivateStorage(tmp_path).path_for(uuid4(), key)

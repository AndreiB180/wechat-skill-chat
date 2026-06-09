"""Chat history CRUD with file locking."""
from pathlib import Path
from .config import locked_read, locked_write, BASE_DIR

HISTORY_DIR = BASE_DIR / "chat_history"
HISTORY_DIR.mkdir(exist_ok=True)


def _path(skill_id):
    return HISTORY_DIR / f"{skill_id}.json"


def load(skill_id):
    data = locked_read(_path(skill_id))
    if data is None:
        return []
    if not isinstance(data, list):
        return []
    return data


def save(skill_id, history):
    locked_write(_path(skill_id), history[-300:])


def clear(skill_id):
    p = _path(skill_id)
    if p.exists():
        locked_write(p, [])
        p.unlink()

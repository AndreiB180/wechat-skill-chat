"""Chat history CRUD with file locking.

两件事和最初的实现不同：

1. **每条消息带稳定 id**。原来前端用数组下标去定位一条消息（比如让后端给某条
   合成语音），但下面的截断会让下标整体前移 —— 会话一旦顶到上限，前端说的
   「第 302 条」在后端就越界了，语音因此一直退回文字。改成按 id 寻址。

2. **超出上限的消息归档而不是丢弃**。原来直接 `history[-300:]` 扔掉最旧的，
   聊久了就掉历史。现在溢出的部分追加到 archive/<id>.jsonl，一条都不删。
"""
import json, uuid
from pathlib import Path

from .config import locked_read, locked_write, BASE_DIR

HISTORY_DIR = BASE_DIR / "chat_history"
ARCHIVE_DIR = HISTORY_DIR / "archive"
HISTORY_DIR.mkdir(exist_ok=True)

ACTIVE_LIMIT = 400   # 活跃文件里保留的条数，超出的进归档


def _path(skill_id):
    return HISTORY_DIR / f"{skill_id}.json"


def _archive_path(skill_id):
    return ARCHIVE_DIR / f"{skill_id}.jsonl"


def new_id():
    return uuid.uuid4().hex[:12]


def _ensure_ids(history):
    """给缺 id 的消息补上。返回是否有改动。"""
    changed = False
    for m in history:
        if not m.get("id"):
            m["id"] = new_id()
            changed = True
    return changed


def load(skill_id):
    data = locked_read(_path(skill_id))
    if not isinstance(data, list):
        return []
    # 存量记录没有 id，第一次读到就补齐并写回，之后 id 就稳定了
    if _ensure_ids(data):
        locked_write(_path(skill_id), data)
    return data


def index_of(history, msg_id):
    """按 id 找下标，找不到返回 -1。"""
    if not msg_id:
        return -1
    for i, m in enumerate(history):
        if m.get("id") == msg_id:
            return i
    return -1


def save(skill_id, history):
    _ensure_ids(history)
    if len(history) > ACTIVE_LIMIT:
        overflow = history[:-ACTIVE_LIMIT]
        history = history[-ACTIVE_LIMIT:]
        _append_archive(skill_id, overflow)
    locked_write(_path(skill_id), history)
    return history


def _append_archive(skill_id, messages):
    if not messages:
        return
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    with open(_archive_path(skill_id), "a", encoding="utf-8") as f:
        for m in messages:
            f.write(json.dumps(m, ensure_ascii=False) + "\n")


def load_archive(skill_id):
    """读回归档的消息（按时间从旧到新）。搜索历史时用得上。"""
    p = _archive_path(skill_id)
    if not p.exists():
        return []
    out = []
    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def load_all(skill_id):
    """归档 + 活跃，完整历史。"""
    return load_archive(skill_id) + load(skill_id)


def clear(skill_id):
    p = _path(skill_id)
    if p.exists():
        locked_write(p, [])
        p.unlink()
    a = _archive_path(skill_id)
    if a.exists():
        a.unlink()

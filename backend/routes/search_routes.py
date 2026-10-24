"""聊天记录全文搜索。

侧栏那个搜索框原来只是按联系人名字过滤列表，微信实际搜的是**消息内容**：
按会话分组，每组给出命中片段和「共 N 条相关聊天记录」。这里提供数据，
前端负责渲染下拉面板和独立的搜索窗口。

搜索范围包含归档（archive/*.jsonl），所以聊了很久的老消息也能搜到。
"""
from flask import Blueprint, request, jsonify

from ..config import load_config
from .. import history as hist
from .group_routes import load_groups

search_bp = Blueprint("search", __name__)

MAX_PREVIEW_PER_CHAT = 3     # 下拉面板里每个会话最多预览几条
SNIPPET_PAD = 12             # 命中词左右各留多少字


def _snippet(content, q):
    """截出含关键词的片段，返回 (前, 命中, 后)，方便前端把命中词标绿。"""
    i = content.lower().find(q.lower())
    if i < 0:
        return content[:40], "", ""
    start = max(0, i - SNIPPET_PAD)
    end = min(len(content), i + len(q) + SNIPPET_PAD * 2)
    return (("…" if start > 0 else "") + content[start:i],
            content[i:i + len(q)],
            content[i + len(q):end] + ("…" if end < len(content) else ""))


def _scan(chat_id, name, avatar, ctype, q, members=None):
    msgs = hist.load_all(chat_id)
    hits = []
    for m in msgs:
        if m.get("deleted") or m.get("sender") == "system":
            continue
        content = m.get("content") or ""
        if q.lower() not in content.lower():
            continue
        pre, mid, post = _snippet(content, q)
        hits.append({
            "id": m.get("id"),
            "sender_name": m.get("sender_name") or ("我" if m.get("sender") == "user" else name),
            "is_self": m.get("sender") == "user",
            "timestamp": m.get("timestamp", 0),
            "content": content,
            "pre": pre, "hit": mid, "post": post,
        })
    if not hits:
        return None
    hits.sort(key=lambda h: h["timestamp"], reverse=True)
    return {
        "id": chat_id, "name": name, "avatar": avatar, "type": ctype,
        "members": members or [],
        "count": len(hits),
        "latest_ts": hits[0]["timestamp"],
        "preview": hits[:MAX_PREVIEW_PER_CHAT],
    }


@search_bp.route("/api/search")
def api_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"query": "", "chats": [], "total": 0})

    results = []
    for s in load_config()["skills"]:
        r = _scan(s["id"], s["name"], s.get("avatar", ""), "contact", q)
        if r:
            results.append(r)
    for g in load_groups()["groups"]:
        r = _scan(g["id"], g["name"], "", "group", q, members=g.get("members", []))
        if r:
            results.append(r)

    results.sort(key=lambda r: r["latest_ts"], reverse=True)
    return jsonify({
        "query": q,
        "chats": results,
        "total": sum(r["count"] for r in results),
    })


@search_bp.route("/api/search/chat/<chat_id>")
def api_search_in_chat(chat_id):
    """某个会话里的全部命中，给搜索窗口右侧用。"""
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"hits": []})

    name = next((s["name"] for s in load_config()["skills"] if s["id"] == chat_id), None)
    is_group = False
    if name is None:
        name = next((g["name"] for g in load_groups()["groups"] if g["id"] == chat_id), chat_id)
        is_group = True

    avatars = {s["id"]: s.get("avatar", "") for s in load_config()["skills"]}
    names = {s["id"]: s["name"] for s in load_config()["skills"]}
    self_avatar = ""   # 前端用自己的头像补上

    hits = []
    for m in hist.load_all(chat_id):
        if m.get("deleted") or m.get("sender") == "system":
            continue
        content = m.get("content") or ""
        if q.lower() not in content.lower():
            continue
        sender = m.get("sender")
        pre, mid, post = _snippet(content, q)
        hits.append({
            "id": m.get("id"),
            "timestamp": m.get("timestamp", 0),
            "is_self": sender == "user",
            "sender_name": m.get("sender_name") or ("我" if sender == "user" else name),
            "avatar": self_avatar if sender == "user" else avatars.get(sender, avatars.get(chat_id, "")),
            "content": content,
            "pre": pre, "hit": mid, "post": post,
        })
    hits.sort(key=lambda h: h["timestamp"], reverse=True)
    return jsonify({"chat_id": chat_id, "name": name, "is_group": is_group,
                    "query": q, "hits": hits, "count": len(hits)})

"""Routes for group chat: create, delete, send, history with router agent."""
import json, time, random, re
from pathlib import Path
from datetime import datetime
from flask import Blueprint, request, jsonify
from ..config import load_config, locked_write, locked_read, load_settings
from ..skills import load_skill_persona
from ..ai import split_message, WECHAT_FORMAT_INSTRUCTION, _get_client, _get_model

group_bp = Blueprint("group", __name__)
BASE_DIR = Path(__file__).parent.parent.parent
GROUPS_FILE = BASE_DIR / "groups_config.json"
GROUP_HISTORY_DIR = BASE_DIR / "chat_history"
GROUP_HISTORY_DIR.mkdir(exist_ok=True)


def load_groups():
    return locked_read(GROUPS_FILE) or {"groups": []}


def save_groups(data):
    locked_write(GROUPS_FILE, data)


def get_nickname():
    return load_settings().get("nickname", "微信用户")


def load_group_history(gid):
    p = GROUP_HISTORY_DIR / f"{gid}.json"
    return locked_read(p) or []


def save_group_history(gid, history):
    locked_write(GROUP_HISTORY_DIR / f"{gid}.json", history[-300:])


# ---- Group CRUD ----
@group_bp.route("/api/groups", methods=["GET"])
def api_groups():
    return jsonify(load_groups()["groups"])


@group_bp.route("/api/groups", methods=["POST"])
def api_create_group():
    data = request.json or {}
    member_ids = data.get("members", [])
    if len(member_ids) < 1:
        return jsonify({"error": "至少需要一个成员"}), 400
    cfg = load_config()
    names = [next((s["name"] for s in cfg["skills"] if s["id"] == mid), mid) for mid in member_ids]
    default_name = "、".join([get_nickname()] + names)
    import hashlib
    gid = "grp_" + hashlib.md5(("-".join(sorted(member_ids))).encode()).hexdigest()[:8]
    gcfg = load_groups()
    if any(g["id"] == gid for g in gcfg["groups"]):
        return jsonify({"error": "群聊已存在"}), 400
    gcfg["groups"].append({"id": gid, "name": default_name, "members": member_ids})
    save_groups(gcfg)
    return jsonify({"ok": True, "group": gcfg["groups"][-1]})


@group_bp.route("/api/groups/<gid>", methods=["DELETE"])
def api_delete_group(gid):
    gcfg = load_groups()
    gcfg["groups"] = [g for g in gcfg["groups"] if g["id"] != gid]
    save_groups(gcfg)
    hp = GROUP_HISTORY_DIR / f"{gid}.json"
    if hp.exists(): hp.unlink()
    return jsonify({"ok": True})


@group_bp.route("/api/groups/<gid>/rename", methods=["POST"])
def api_rename_group(gid):
    data = request.json or {}
    gcfg = load_groups()
    for g in gcfg["groups"]:
        if g["id"] == gid:
            g["name"] = data.get("name", g["name"])
            break
    save_groups(gcfg)
    return jsonify({"ok": True})


@group_bp.route("/api/groups/<gid>/history")
def api_group_history(gid):
    return jsonify(load_group_history(gid))


# ---- Internal helpers ----
def _direct_call(persona, system_extra, messages):
    """Call the API directly without call_skill's sender-based history parsing."""
    client = _get_client()
    model = _get_model()
    if not client or not model:
        return None
    full_system = WECHAT_FORMAT_INSTRUCTION + system_extra + "\n\n" + persona
    try:
        resp = client.messages.create(model=model, max_tokens=1024, system=full_system, messages=messages)
        for block in resp.content:
            if hasattr(block, "text"):
                return block.text
    except Exception as e:
        return f"[错误] {str(e)}"
    return None


def _router_decide(user_msg, members_info, recent_history):
    """Lightweight router: which member should reply next? Returns name or None."""
    member_list = "\n".join(f"- {m['name']}：{m['desc']}" for m in members_info)
    history_text = "\n".join(
        f"{h.get('sender_name','?')}：{h['content']}" for h in recent_history[-8:]
    )
    prompt = (
        f"群聊中有以下成员：\n{member_list}\n\n最近对话：\n{history_text}\n\n"
        f"有人说：{user_msg}\n\n"
        f"请判断哪个成员最可能回复。只返回一个名字。如果没有人应该回复，返回 NONE。\n只返回名字或NONE，不要其他文字。"
    )
    client = _get_client()
    model = _get_model()
    if not client or not model:
        return None
    try:
        resp = client.messages.create(model=model, max_tokens=10, system="", messages=[{"role": "user", "content": prompt}])
        name = resp.content[0].text.strip()
        if name.upper() == "NONE":
            return None
        for m in members_info:
            if m["name"] in name:
                return m
        return members_info[0] if members_info else None
    except:
        return members_info[0] if members_info else None


def _build_group_messages(history, speaker_name, message, all_members_info):
    """Build messages array for group API call, including recent chat history."""
    others = [m for m in all_members_info]
    others_desc = "\n".join(f"- {m['name']}：{m['desc']}" for m in others)

    system_extra = (
        f"你正在一个微信群聊里。你的名字是{speaker_name}。\n"
        f"群里其他人：\n{others_desc}\n"
        f"直接输出回复内容。不要在前面加你的名字，不要用'某某说：'格式。就用自然语言。"
    )

    messages = []
    for h in history[-12:]:
        role = "assistant" if h.get("sender") != "user" else "user"
        sn = h.get('sender_name', '?')
        content = h['content']
        if role == "user":
            messages.append({"role": "user", "content": f"{sn}：{content}"})
        else:
            messages.append({"role": "assistant", "content": content})
    messages.append({"role": "user", "content": message})
    return system_extra, messages


# ---- Group Send ----
@group_bp.route("/api/groups/<gid>/send", methods=["POST"])
def api_group_send(gid):
    data = request.json or {}
    message = data.get("message", "").strip()
    if not message:
        return jsonify({"error": "empty"}), 400

    gcfg = load_groups()
    group = next((g for g in gcfg["groups"] if g["id"] == gid), None)
    if not group:
        return jsonify({"error": "group not found"}), 404

    cfg = load_config()
    members = [s for s in cfg["skills"] if s["id"] in group["members"]]
    if not members:
        return jsonify({"responses": []})

    nickname = get_nickname()
    history = load_group_history(gid)
    ts = datetime.now().strftime("%H:%M")
    now_ts = time.time()
    history.append({"sender": "user", "sender_name": nickname, "content": message, "time": ts, "timestamp": now_ts})

    members_info = [{"id": s["id"], "name": s["name"], "desc": s.get("default_note", "") or s["name"]} for s in members]

    # Detect @mention
    mention = None
    m = re.match(r'^@(\S+)\s', message)
    if m:
        name = m.group(1)
        if name == "所有人":
            mention = "all"
        else:
            for s in members:
                if s["name"] == name:
                    mention = s
                    break

    all_responses = []
    max_iter = random.randint(2, 4)
    iteration = 0

    # First responder(s)
    if mention and mention != "all":
        responders = [mention]
    elif mention == "all":
        responders = members[:]
    else:
        first = _router_decide(message, members_info, history)
        responders = [first] if first else []

    # Iterative reply loop
    while responders and iteration < max_iter:
        for contact_info in responders:
            if iteration >= max_iter:
                break
            # Resolve to actual skill config (router returns members_info dict, not skill config)
            contact = next((s for s in members if s["id"] == contact_info["id"]), None)
            if not contact:
                continue
            skill_key = contact.get("skill_name") or contact.get("id") or contact.get("name","")
            persona = load_skill_persona(skill_key)
            if not persona:
                skill_file = BASE_DIR / "skills" / f"{skill_key}.md"
                if skill_file.exists():
                    persona = skill_file.read_text(encoding="utf-8")
            if not persona:
                continue

            # Determine who is speaking TO this person
            if iteration == 0:
                speaker = nickname
            else:
                last_bot = None
                for h in reversed(history):
                    if h.get("sender") == "bot":
                        last_bot = h.get("sender_name", "")
                        break
                speaker = last_bot or nickname

            sys_extra, msgs = _build_group_messages(history, contact["name"], message, members_info)
            # Fix: the last message should be addressed TO this person
            if iteration > 0 and all_responses:
                msgs.append({"role": "user", "content": all_responses[-1]['content']})

            response = _direct_call(persona, sys_extra, msgs)
            if not response or response.startswith("[错误]"):
                iteration += 1
                continue

            for msg in split_message(response):
                if iteration >= max_iter:
                    break
                ts2 = datetime.now().strftime("%H:%M")
                history.append({"sender": "bot", "sender_name": contact["name"], "content": msg, "time": ts2, "timestamp": time.time()})
                all_responses.append({"sender": contact["id"], "sender_name": contact["name"], "content": msg, "time": ts2})
            iteration += 1

        # Check if next person should reply
        if iteration < max_iter and not mention and all_responses:
            next_responder = _router_decide(
                all_responses[-1]["content"],
                [m for m in members_info if all_responses and m["id"] not in {r["sender"] for r in all_responses[-2:]}],
                history
            )
            responders = [next_responder] if next_responder else []
            if not responders:
                iteration += 1  # silence counts as iteration
        else:
            break

    save_group_history(gid, history)
    # Also save current iteration state for streaming
    return jsonify({"user": {"content": message, "time": ts}, "responses": all_responses, "done": True})

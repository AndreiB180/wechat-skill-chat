"""Routes for group chat: create, delete, send, history with streaming router agent."""
import json, time, random, re
from pathlib import Path
from datetime import datetime
from flask import Blueprint, request, jsonify, Response, stream_with_context
from ..config import load_config, locked_write, locked_read, load_settings
from ..skills import load_skill_persona
from ..ai import split_message, WECHAT_FORMAT_INSTRUCTION, _get_client, _get_model, _get_mode
from .. import history as hist

group_bp = Blueprint("group", __name__)
BASE_DIR = Path(__file__).parent.parent.parent
GROUPS_FILE = BASE_DIR / "groups_config.json"


def load_groups():
    return locked_read(GROUPS_FILE) or {"groups": []}


def save_groups(data):
    locked_write(GROUPS_FILE, data)


def get_nickname():
    return load_settings().get("nickname", "微信用户")


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
    # Persist the system invitation message so it survives page reload
    ts = datetime.now().strftime("%H:%M")
    hist.save(gid, [{"sender": "system", "content": f"{get_nickname()}邀请{'、'.join(names)}加入了群聊", "time": ts, "timestamp": time.time()}])
    return jsonify({"ok": True, "group": gcfg["groups"][-1]})


@group_bp.route("/api/groups/<gid>", methods=["DELETE"])
def api_delete_group(gid):
    gcfg = load_groups()
    gcfg["groups"] = [g for g in gcfg["groups"] if g["id"] != gid]
    save_groups(gcfg)
    hist.clear(gid)
    return jsonify({"ok": True})


@group_bp.route("/api/groups/<gid>/clear", methods=["POST"])
def api_clear_group_history(gid):
    hist.clear(gid)
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
    return jsonify(hist.load(gid))


@group_bp.route("/api/groups/<gid>/delete_message", methods=["POST"])
def api_group_delete_message(gid):
    data = request.json or {}
    idx = data.get("index")
    if idx is None:
        return jsonify({"error": "缺少索引"}), 400
    history = hist.load(gid)
    if 0 <= idx < len(history):
        history[idx]["deleted"] = True
    hist.save(gid, history)
    return jsonify({"ok": True})


# ---- Internal helpers ----
def _strip_all_prefixes(text, all_member_names):
    """Strip any member name prefix from model output (e.g. '乐天：你好' -> '你好')."""
    for name in all_member_names:
        if not name or len(name) < 2:
            continue
        pattern = re.compile(rf'^{re.escape(name)}\s*[：:]\s*')
        text = pattern.sub('', text)
    return text


def _direct_call(persona, system_extra, messages):
    """Call the API directly."""
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


def _find_mentioned_names(text, members_info):
    """Check if any member's real_name or display name appears in the text."""
    mentioned = []
    for m in members_info:
        rn = m.get("real_name", "")
        dn = m["name"]
        if rn and rn in text:
            mentioned.append(m)
        elif dn and dn in text:
            mentioned.append(m)
    return mentioned


def _router_decide(user_msg, members_info, recent_history):
    """Lightweight router: which member should reply next?"""
    member_list = "\n".join(f"- {m['name']}（真名：{m.get('real_name', m['name'])}）" for m in members_info)
    history_text = "\n".join(
        f"{h.get('sender_name','?')}：{h['content']}" for h in recent_history[-8:]
    )
    prompt = (
        f"群聊中有以下成员：\n{member_list}\n\n最近对话：\n{history_text}\n\n"
        f"有人说：{user_msg}\n\n"
        f"请判断哪个成员最可能回复。如果消息中提到了某个成员的名字，该成员必须回复。只返回一个名字。如果没有人应该回复，返回 NONE。"
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
            if m["name"] in name or m.get("real_name", "") in name:
                return m
        return members_info[0] if members_info else None
    except:
        return members_info[0] if members_info else None


def _build_system_extra(speaker_name, speaker_real_name, all_members_info, history, previous_bot_responses=None):
    """Build system prompt with full chat history as reference (not in messages array, to avoid model copying format)."""
    others = [m for m in all_members_info if m["name"] != speaker_name]
    # List members by REAL name primarily
    others_list = "\n".join(f"- 真名：{m.get('real_name', m['name'])}（备注：{m['name']}）" for m in others)

    # Build chat history in system prompt (reference only, not for copying)
    history_text = ""
    for h in history[-25:]:
        sn = h.get('sender_name', '?')
        if h.get('sender') == 'system':
            history_text += f"  [系统通知] {h['content']}\n"
        else:
            history_text += f"  {sn} 说：{h['content']}\n"

    extra = (
        f"你现在在一个微信群聊里。群里成员只有以下几人：\n"
        f"你自己 - 真名：{speaker_real_name}（群里显示为：{speaker_name}）\n"
        f"{others_list}\n\n"
        f"最近聊天记录（仅供参考上下文，不要模仿输出格式）：\n"
        f"{history_text}\n"
    )

    if previous_bot_responses:
        extra += f"\n⚠️ 在你发言之前，其他人刚刚说了以下内容：\n"
        for r in previous_bot_responses[-5:]:
            extra += f"  - {r['sender_name']} 说：{r['content']}\n"

    extra += (
        f"\n════════════════════════════\n"
        f"【铁律 - 每条都必须遵守】\n"
        f"1. 群里只有上面列出的几个人。不要提不在名单里的人。\n"
        f"2. 你必须用真名称呼其他人。叫「吕睿」不叫「乐天」。\n"
        f"3. 禁止在消息前加任何人的名字、冒号、括号。\n"
        f"4. 上面⚠️标记的内容别人已经说过了，你绝对不能再复述或变相复述，除非你要直接反驳它。你必须说点不一样的、新的内容。\n"
        f"5. 禁止编造。你只能基于你的 persona 设定里明确提到的事实和聊天记录里已出现的信息发言。不要凭空捏造不存在的事件、人物、经历。"
    )

    return extra


def _build_messages(user_message, sender_name):
    """Build minimal messages array - only the user trigger, no history. History goes in system prompt."""
    return [{"role": "user", "content": f"{sender_name} 说：{user_message}"}]


# ---- Group Send (streaming SSE) ----
@group_bp.route("/api/groups/<gid>/send", methods=["POST"])
def api_group_send(gid):
    data = request.json or {}
    message = data.get("message", "").strip()
    if not message:
        return jsonify({"error": "消息为空"}), 400

    gcfg = load_groups()
    group = next((g for g in gcfg["groups"] if g["id"] == gid), None)
    if not group:
        return jsonify({"error": "群聊不存在"}), 404

    if _get_mode() == "claude":
        return jsonify({"error": "Claude Code 模式下不支持群聊，请切回 API 模式。"}), 400

    cfg = load_config()
    members = [s for s in cfg["skills"] if s["id"] in group["members"]]
    if not members:
        return jsonify({"responses": []})

    nickname = get_nickname()
    history = hist.load(gid)
    ts = datetime.now().strftime("%H:%M")
    now_ts = time.time()
    history.append({"sender": "user", "sender_name": nickname, "content": message, "time": ts, "timestamp": now_ts})
    hist.save(gid, history)

    members_info = [{"id": s["id"], "name": s["name"], "real_name": s.get("real_name", s["name"]), "desc": s.get("default_note", "") or s["name"]} for s in members]
    all_names = []
    for mi in members_info:
        all_names.append(mi["name"])
        if mi.get("real_name") and mi["real_name"] != mi["name"]:
            all_names.append(mi["real_name"])

    # Detect mentions
    mentioned = _find_mentioned_names(message, members_info)
    force_mention = mentioned if mentioned else None
    m = re.match(r'^@(\S+)\s', message)
    if m and not force_mention:
        name = m.group(1)
        if name == "所有人":
            force_mention = members_info[:]
        else:
            for s in members_info:
                if s["name"] == name or s.get("real_name", "") == name:
                    force_mention = [s]
                    break

    all_responses = []
    max_iter = random.randint(2, 3)
    iteration = 0
    responded_ids = set()

    if force_mention:
        responders = force_mention[:]
    else:
        first = _router_decide(message, members_info, history)
        if first:
            responders = [first]
        else:
            # Router unavailable (no API key / Claude Code mode): pick a random member
            responders = [random.choice(members_info)] if members_info else []

    def generate():
        nonlocal iteration, responders, responded_ids
        while responders and iteration < max_iter:
            current_round_responses = []
            for contact_info in responders:
                if iteration >= max_iter:
                    break
                if contact_info["id"] in responded_ids:
                    continue
                contact = next((s for s in members if s["id"] == contact_info["id"]), None)
                if not contact:
                    continue
                skill_key = contact.get("skill_name") or contact.get("id") or contact.get("name", "")
                persona = load_skill_persona(skill_key)
                if not persona:
                    skill_file = BASE_DIR / "skills" / f"{skill_key}.md"
                    if skill_file.exists():
                        persona = skill_file.read_text(encoding="utf-8")
                if not persona:
                    continue

                previous_bot_msgs = [r for r in all_responses] if all_responses else None
                speaker_real_name = contact.get("real_name", contact["name"])
                sys_extra = _build_system_extra(contact["name"], speaker_real_name, members_info, history, previous_bot_msgs)
                msgs = _build_messages(message, nickname)

                response = _direct_call(persona, sys_extra, msgs)
                if not response or response.startswith("[错误]"):
                    continue
                response = _strip_all_prefixes(response, all_names)

                for msg in split_message(response):
                    if iteration >= max_iter:
                        break
                    ts2 = datetime.now().strftime("%H:%M")
                    tm = time.time()
                    history.append({"sender": "bot", "sender_name": contact["name"], "content": msg, "time": ts2, "timestamp": tm})
                    all_responses.append({"sender": contact["id"], "sender_name": contact["name"], "content": msg, "time": ts2})
                    current_round_responses.append({"sender": contact["id"], "sender_name": contact["name"], "content": msg, "time": ts2})
                    yield f"data: {json.dumps({'sender': contact['id'], 'sender_name': contact['name'], 'content': msg, 'time': ts2}, ensure_ascii=False)}\n\n"
                responded_ids.add(contact_info["id"])
                iteration += 1

            # Next responder
            if iteration < max_iter and not force_mention:
                unspoken = [m for m in members_info if m["id"] not in responded_ids]
                if unspoken:
                    if random.random() < 0.9:
                        responders = [random.choice(unspoken)]
                    else:
                        responders = [random.choice(members_info)]
                else:
                    last_content = ""
                    if current_round_responses:
                        last_content = " ".join(r["content"] for r in current_round_responses[-3:])
                    elif all_responses:
                        last_content = all_responses[-1]["content"]
                    if last_content and random.random() < 0.9:
                        mentions = _find_mentioned_names(last_content, members_info)
                        responders = mentions[:1] if mentions else []
                    elif random.random() < 0.5:
                        responders = [random.choice(members_info)]
                    else:
                        responders = []
            else:
                responders = []

        hist.save(gid, history)
        yield f"data: {json.dumps({'done': True}, ensure_ascii=False)}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")

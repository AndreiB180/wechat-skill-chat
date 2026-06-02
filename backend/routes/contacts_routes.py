"""Routes for /api/config, /api/import_skill, /api/delete_skill, /api/update_contact"""
import hashlib
from pathlib import Path
from flask import Blueprint, request, jsonify
from ..config import load_config, save_config, locked_read
from ..history import clear as clear_history

contacts_bp = Blueprint("contacts", __name__)
BASE_DIR = Path(__file__).parent.parent.parent


@contacts_bp.route("/api/config")
def api_config():
    return jsonify(load_config()["skills"])


@contacts_bp.route("/api/update_contact/<skill_id>", methods=["POST"])
def api_update_contact(skill_id):
    data = request.json or {}
    cfg = load_config()
    for s in cfg["skills"]:
        if s["id"] == skill_id:
            if "name" in data: s["name"] = data["name"]
            if "note" in data: s["default_note"] = data["note"]
            if "avatar" in data: s["avatar"] = data["avatar"]
            break
    save_config(cfg)
    return jsonify({"ok": True})


@contacts_bp.route("/api/delete_skill/<skill_id>", methods=["POST"])
def api_delete_skill(skill_id):
    cfg = load_config()
    cfg["skills"] = [s for s in cfg["skills"] if s["id"] != skill_id]
    save_config(cfg)
    clear_history(skill_id)
    return jsonify({"ok": True})


@contacts_bp.route("/api/import_skill", methods=["POST"])
def api_import_skill():
    data = request.json or {}
    folder_path = data.get("path", "").strip()
    if not folder_path:
        return jsonify({"error": "请提供文件夹路径"}), 400

    p = Path(folder_path)
    if not p.exists() or not p.is_dir():
        return jsonify({"error": "文件夹不存在"}), 400

    skill_md = p / "SKILL.md"
    persona_md = p / "persona.md"
    meta_json = p / "meta.json"

    content = None
    if skill_md.exists():
        content = skill_md.read_text(encoding="utf-8")
    elif persona_md.exists():
        content = persona_md.read_text(encoding="utf-8")
        work_md = p / "work.md"
        if work_md.exists():
            content = content + "\n\n" + work_md.read_text(encoding="utf-8")
    else:
        return jsonify({"error": "文件夹格式不正确：需要 SKILL.md 或 persona.md"}), 400

    name = p.name
    skill_name = p.name
    if meta_json.exists():
        try:
            meta = locked_read(meta_json)
            if meta:
                name = meta.get("display_name") or meta.get("name") or p.name
                skill_name = meta.get("name") or p.name
        except Exception:
            pass

    skill_id = "sk_" + hashlib.md5(name.encode()).hexdigest()[:8]
    skill_name_clean = skill_name.replace("colleague-", "").replace("relationship-", "")

    dest = BASE_DIR / "skills" / f"{skill_name_clean}.md"
    dest.write_text(content, encoding="utf-8")

    avatar_path = f"avatars/{skill_id}.svg"
    initial = name[0] if name else "?"
    colors = ["#4A90D9","#E85D75","#F5A623","#7ED321","#BD10E0","#50C878","#FF6B6B","#4ECDC4"]
    color = colors[hash(name) % len(colors)]
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        f'<rect width="100" height="100" rx="10" fill="{color}"/>'
        f'<text x="50" y="68" font-size="55" font-family="sans-serif" fill="white" text-anchor="middle" font-weight="bold">{initial}</text>'
        f'</svg>'
    )
    (BASE_DIR / "static" / avatar_path).write_text(svg, encoding="utf-8")

    cfg = load_config()
    for s in cfg["skills"]:
        if s["id"] == skill_id:
            return jsonify({"error": "该 Skill 已存在"}), 400

    cfg["skills"].append({
        "id": skill_id, "name": name,
        "skill_name": skill_name_clean,
        "avatar": avatar_path, "default_note": "",
    })
    save_config(cfg)
    return jsonify({"ok": True, "skill": cfg["skills"][-1]})

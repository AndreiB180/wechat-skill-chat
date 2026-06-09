"""Routes for /api/settings"""
import base64
from flask import Blueprint, request, jsonify
from ..config import load_settings, save_settings
from ..claude_cli import check_claude_cli
from ..claude_session import _sessions, _lock

settings_bp = Blueprint("settings", __name__)


def _obfuscate(s):
    return base64.b64encode(s.encode()).decode()


@settings_bp.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    if request.method == "GET":
        s = load_settings()
        if s.get("api_key"):
            key = s["api_key"]
            if key.startswith("obf:"):
                s = {**s, "api_key": "••••已保存••••"}
            elif len(key) > 8:
                s = {**s, "api_key": key[:4] + "••••" + key[-4:]}
        s.setdefault("mode", "api")
        s.setdefault("claude_cli", "ccb")
        return jsonify(s)

    data = request.json or {}
    s = load_settings()
    old_dirs = s.get("add_dirs")
    old_mode = s.get("mode")
    for k in ["base_url", "model", "my_avatar", "nickname", "mode", "claude_cli", "permission_mode", "add_dirs"]:
        if k in data:
            s[k] = data[k]
    if data.get("api_key") and data["api_key"] != "••••已保存••••":
        raw = data["api_key"].strip()
        if not any(c in raw for c in ['•', '…']):
            s["api_key"] = "obf:" + _obfuscate(raw)
    save_settings(s)

    # Mode switch CC→API: gracefully close all CC sessions (logout), keep persisted files for resume
    new_mode = s.get("mode")
    if old_mode == "claude" and new_mode != "claude":
        with _lock:
            for sid, sess in list(_sessions.items()):
                try:
                    sess._close()
                except Exception:
                    pass
            _sessions.clear()

    # Permission mode change: do NOT attempt in-band control_request via stdin.
    # It can interleave with CC's internal conversation state and cause tool_result
    # association to be lost → API 400 "tool_use without tool_result".
    # Existing sessions keep their original mode; new sessions will pick up the
    # new mode. To apply to an active chat, use the "清空Session" button.

    # Workdir change: kill all sessions, clear persisted files (can't resume across dirs)
    new_dirs = s.get("add_dirs")
    if new_dirs != old_dirs:
        from ..claude_session import close_all_sessions
        close_all_sessions()

    return jsonify({"ok": True})


@settings_bp.route("/api/settings/check_claude", methods=["POST"])
def api_check_claude():
    data = request.json or {}
    cli_path = data.get("claude_cli", "ccb").strip()
    ok, info = check_claude_cli(cli_path)
    return jsonify({"ok": ok, "version": info})

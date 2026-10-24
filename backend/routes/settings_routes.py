"""Routes for /api/settings"""
from flask import Blueprint, request, jsonify
from ..config import load_settings, save_settings
from ..claude_cli import check_claude_cli
from ..claude_session import _sessions, _lock
from ..keychain import store as store_key, MARKER as KEYCHAIN_MARKER, available as keychain_ok

settings_bp = Blueprint("settings", __name__)
MASK = "••••已保存••••"


@settings_bp.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    if request.method == "GET":
        s = load_settings()
        # 永远不把真实密钥回传给前端
        if s.get("api_key"):
            s = {**s, "api_key": MASK}
        s.setdefault("mode", "api")
        s.setdefault("claude_cli", "claude")
        s["key_in_keychain"] = str(load_settings().get("api_key", "")).startswith(KEYCHAIN_MARKER)
        s["keychain_available"] = keychain_ok()
        return jsonify(s)

    data = request.json or {}
    s = load_settings()
    old_dirs = s.get("add_dirs")
    old_mode = s.get("mode")
    for k in ["base_url", "model", "my_avatar", "nickname", "mode", "claude_cli",
              "permission_mode", "add_dirs", "voice_url"]:
        if k in data:
            s[k] = data[k]
    if data.get("api_key") and data["api_key"] != MASK:
        raw = data["api_key"].strip()
        if raw and not any(c in raw for c in ['•', '…']):
            # 优先进钥匙串；不可用时 store() 自己回退到混淆存文件
            s["api_key"] = store_key(raw)
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
    cli_path = data.get("claude_cli", "claude").strip()
    ok, info = check_claude_cli(cli_path)
    return jsonify({"ok": ok, "version": info})

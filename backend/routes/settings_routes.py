"""Routes for /api/settings"""
import base64
from flask import Blueprint, request, jsonify
from ..config import load_settings, save_settings

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
        return jsonify(s)

    data = request.json or {}
    s = load_settings()
    for k in ["base_url", "model", "my_avatar"]:
        if data.get(k):
            s[k] = data[k]
    if data.get("api_key") and data["api_key"] != "••••已保存••••":
        raw = data["api_key"].strip()
        if not any(c in raw for c in ['•', '⋯']):
            s["api_key"] = "obf:" + _obfuscate(raw)
    save_settings(s)
    return jsonify({"ok": True})

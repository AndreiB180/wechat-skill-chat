"""Routes for static files: /avatars, /emoji"""
import uuid
from pathlib import Path
from flask import Blueprint, send_from_directory, request, jsonify

static_bp = Blueprint("static_files", __name__)
BASE_DIR = Path(__file__).parent.parent.parent
AVATAR_DIR = BASE_DIR / "static" / "avatars"
AVATAR_DIR.mkdir(parents=True, exist_ok=True)


@static_bp.route("/avatars/<path:filename>")
def avatars(filename):
    return send_from_directory(AVATAR_DIR, filename)


@static_bp.route("/api/upload_avatar", methods=["POST"])
def upload_avatar():
    if "file" not in request.files:
        return jsonify({"error": "未上传文件"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "文件名为空"}), 400
    ext = Path(f.filename).suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"):
        return jsonify({"error": "不支持的图片格式"}), 400
    name = uuid.uuid4().hex[:8] + ext
    f.save(str(AVATAR_DIR / name))
    return jsonify({"ok": True, "path": f"avatars/{name}"})


@static_bp.route("/emoji/<path:filepath>")
def emoji_files(filepath):
    return send_from_directory(BASE_DIR / "static" / "emoji", filepath)

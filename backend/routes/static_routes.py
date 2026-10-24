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


@static_bp.route("/api/emoji_manifest")
def emoji_manifest():
    """扫描磁盘上真实存在的表情 PNG，返回 {表情名: 所在目录}。

    前端原来把这份清单硬编码在 chat.js 里，和磁盘素材已经漂移到
    113 个里有 37 个没有对应图片 —— 面板里空一片、聊天气泡里显示成 [酷] 这种裸文本。
    改成以磁盘为准动态生成后，加删素材都不会再漂移。
    """
    root = BASE_DIR / "static" / "emoji"
    manifest = {}
    if root.is_dir():
        for sub in sorted(root.iterdir()):
            if not sub.is_dir():
                continue
            for png in sorted(sub.glob("*.png")):
                manifest[png.stem] = sub.name
    return jsonify(manifest)

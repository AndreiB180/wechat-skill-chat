"""Routes for static files: /avatars, /emoji"""
from pathlib import Path
from flask import Blueprint, send_from_directory

static_bp = Blueprint("static_files", __name__)
BASE_DIR = Path(__file__).parent.parent.parent


@static_bp.route("/avatars/<path:filename>")
def avatars(filename):
    return send_from_directory(BASE_DIR / "static" / "avatars", filename)


@static_bp.route("/emoji/<path:filepath>")
def emoji_files(filepath):
    return send_from_directory(BASE_DIR / "static" / "emoji", filepath)

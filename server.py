#!/usr/bin/env python3
"""WeChat PC Skill Chat — Entry point. Portable: drop anywhere and run.

浏览器模式入口。原生 macOS 应用请用 app_native.py。
调试模式（Werkzeug 调试器可导致远程代码执行）默认关闭，
需要时用 WECHAT_DEBUG=1 python3 server.py 显式开启。
"""

import webbrowser, os, signal, socket

from flask import Flask, render_template, jsonify
from backend.routes.settings_routes import settings_bp
from backend.routes.contacts_routes import contacts_bp
from backend.routes.chat_routes import chat_bp
from backend.routes.group_routes import group_bp
from backend.routes.static_routes import static_bp
from backend.routes.voice_routes import voice_bp
from backend.routes.search_routes import search_bp

app = Flask(__name__)
app.register_blueprint(settings_bp)
app.register_blueprint(contacts_bp)
app.register_blueprint(chat_bp)
app.register_blueprint(group_bp)
app.register_blueprint(static_bp)
app.register_blueprint(voice_bp)
app.register_blueprint(search_bp)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/search_window")
def search_window():
    """「搜索聊天记录」独立窗口的页面。原生模式下由 app_native 开成第二个系统窗口。"""
    return render_template("search_window.html")


@app.route("/api/shutdown", methods=["POST"])
def shutdown():
    os.kill(os.getpid(), signal.SIGTERM)
    return jsonify({"ok": True})


def find_free_port(preferred=5888):
    """Return `preferred` if it is free, otherwise an OS-assigned free port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 0)) or find_free_port(5888)
    debug = os.environ.get("WECHAT_DEBUG") == "1"
    webbrowser.open(f"http://localhost:{port}")
    print(f"WeChat Skill Chat → http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, debug=debug, use_reloader=False)

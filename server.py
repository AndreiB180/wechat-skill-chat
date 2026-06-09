#!/usr/bin/env python3
"""WeChat PC Skill Chat — Entry point. Portable: drop anywhere and run."""

import webbrowser, os, signal

from flask import Flask, render_template, jsonify
from backend.routes.settings_routes import settings_bp
from backend.routes.contacts_routes import contacts_bp
from backend.routes.chat_routes import chat_bp
from backend.routes.group_routes import group_bp
from backend.routes.static_routes import static_bp

app = Flask(__name__)
app.register_blueprint(settings_bp)
app.register_blueprint(contacts_bp)
app.register_blueprint(chat_bp)
app.register_blueprint(group_bp)
app.register_blueprint(static_bp)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/shutdown", methods=["POST"])
def shutdown():
    os.kill(os.getpid(), signal.SIGTERM)
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5888))
    webbrowser.open(f"http://localhost:{port}")
    print(f"WeChat Skill Chat → http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, debug=True, use_reloader=False)

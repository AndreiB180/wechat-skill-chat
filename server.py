#!/usr/bin/env python3
"""WeChat PC Skill Chat — Entry point. Portable: drop anywhere and run."""

from flask import Flask, render_template
from backend.routes.settings_routes import settings_bp
from backend.routes.contacts_routes import contacts_bp
from backend.routes.chat_routes import chat_bp
from backend.routes.static_routes import static_bp

app = Flask(__name__)
app.register_blueprint(settings_bp)
app.register_blueprint(contacts_bp)
app.register_blueprint(chat_bp)
app.register_blueprint(static_bp)


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    print("WeChat Skill Chat starting...")
    print("Open http://localhost:5888")
    app.run(host="0.0.0.0", port=5888, debug=True, use_reloader=False)

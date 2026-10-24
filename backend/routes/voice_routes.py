"""Routes for local TTS: 语音配置、测试、合成、引擎管理。

启用门槛：enabled 只有在 verified 为真时才允许打开，而 verified 只由后端在
「真的合成出音频」之后置位。改动任何模型参数都会把 verified 清掉，必须重测。
"""
import platform, subprocess
from pathlib import Path

from flask import Blueprint, request, jsonify, send_from_directory

from ..history import load as load_history, save as save_history, index_of
from ..voice import (
    CACHE_DIR, load_voice_config, save_voice_config, synthesize, synthesize_with,
    ensure_engine, stop_engine, engine_status, get_voice,
)

voice_bp = Blueprint("voice", __name__)

TEST_SENTENCE = "喂，能听见吗？这是语音测试。"
# 改这些字段就说明换了模型/音色，之前那次测试不再作数
INVALIDATING = {"gpt_weights", "sovits_weights", "ref_audio", "ref_text", "lang", "ref_lang"}


@voice_bp.route("/voice_cache/<path:filename>")
def voice_cache(filename):
    return send_from_directory(CACHE_DIR, filename, mimetype="audio/wav")


@voice_bp.route("/api/voice_config")
def api_voice_config():
    return jsonify(load_voice_config())


@voice_bp.route("/api/voice_config/<skill_id>", methods=["POST"])
def api_save_voice(skill_id):
    data = request.json or {}
    cfg = load_voice_config()
    entry = dict(cfg["voices"].get(skill_id, {}))

    for k in ("gpt_weights", "sovits_weights", "ref_audio", "ref_text",
              "lang", "ref_lang", "speed", "probability"):
        if k in data and data[k] != entry.get(k):
            if k in INVALIDATING:
                entry["verified"] = False
                entry["enabled"] = False
            entry[k] = data[k]

    if data.get("enabled"):
        if not entry.get("verified"):
            return jsonify({"error": "请先测试成功，再启用语音"}), 400
        entry["enabled"] = True
    elif "enabled" in data:
        entry["enabled"] = False

    cfg["voices"][skill_id] = entry
    save_voice_config(cfg)
    return jsonify({"ok": True, "voice": entry})


@voice_bp.route("/api/voice_config/<skill_id>", methods=["DELETE"])
def api_delete_voice(skill_id):
    cfg = load_voice_config()
    cfg["voices"].pop(skill_id, None)
    save_voice_config(cfg)
    return jsonify({"ok": True})


@voice_bp.route("/api/voice/engine", methods=["GET", "POST"])
def api_engine():
    if request.method == "GET":
        return jsonify(engine_status())
    action = (request.json or {}).get("action", "status")
    if action == "stop":
        stop_engine()
        return jsonify({"ok": True, "running": False})
    if action == "start":
        port, err = ensure_engine()
        if err:
            return jsonify({"ok": False, "error": err}), 502
        return jsonify({"ok": True, "port": port})
    return jsonify(engine_status())


@voice_bp.route("/api/voice/test/<skill_id>", methods=["POST"])
def api_voice_test(skill_id):
    """用页面上填的参数真跑一次合成。成功才置 verified。"""
    data = request.json or {}
    voice = {
        "gpt_weights": data.get("gpt_weights", ""),
        "sovits_weights": data.get("sovits_weights", ""),
        "ref_audio": data.get("ref_audio", ""),
        "ref_text": data.get("ref_text", ""),
        "lang": data.get("lang", "zh"),
        "ref_lang": data.get("ref_lang", "zh"),
        "speed": data.get("speed", 1.0),
    }
    text = (data.get("text") or "").strip() or TEST_SENTENCE

    name, seconds, err = synthesize_with(voice, text)
    if err:
        return jsonify({"ok": False, "error": err}), 502

    cfg = load_voice_config()
    entry = {**cfg["voices"].get(skill_id, {}), **voice,
             "verified": True}
    entry.setdefault("probability", 30)
    entry.setdefault("enabled", False)
    cfg["voices"][skill_id] = entry
    save_voice_config(cfg)

    return jsonify({"ok": True, "url": f"/voice_cache/{name}",
                    "duration": seconds, "voice": entry})


@voice_bp.route("/api/tts/<skill_id>", methods=["POST"])
def api_tts(skill_id):
    """把某条消息合成语音。

    传 msg_id 时会把结果写回聊天记录，刷新页面后语音还在；
    传 text 只是临时合成（预览用）。

    注意用 id 而不是数组下标：历史会被截断归档，下标会整体前移，
    之前就是因为这个，前端要的下标在后端越界，语音一直退回文字。
    """
    data = request.json or {}
    msg_id = data.get("msg_id")

    if not msg_id:
        text = (data.get("text") or "").strip()
        if not text:
            return jsonify({"error": "文本为空"}), 400
        name, seconds, err = synthesize(skill_id, text)
        if err:
            return jsonify({"error": err}), 502
        return jsonify({"ok": True, "url": f"/voice_cache/{name}", "duration": seconds})

    history = load_history(skill_id)
    idx = index_of(history, msg_id)
    if idx < 0:
        return jsonify({"error": "找不到这条消息"}), 404

    msg = history[idx]
    if msg.get("voice_url"):
        return jsonify({"ok": True, "url": msg["voice_url"],
                        "duration": msg.get("voice_sec", 1)})

    name, seconds, err = synthesize(skill_id, msg.get("content", ""))
    if err:
        return jsonify({"error": err}), 502

    msg["voice_url"] = f"/voice_cache/{name}"
    msg["voice_sec"] = seconds
    save_history(skill_id, history)
    return jsonify({"ok": True, "url": msg["voice_url"], "duration": seconds})


@voice_bp.route("/api/voice/pick", methods=["POST"])
def api_voice_pick():
    """调系统文件选择器挑模型/音频文件，省得手敲绝对路径。"""
    if platform.system() != "Darwin":
        return jsonify({"path": ""})
    kind = (request.json or {}).get("kind", "file")
    prompts = {
        "gpt": "选择 GPT 权重（.ckpt）",
        "sovits": "选择 SoVITS 权重（.pth）",
        "audio": "选择参考音频（3-10 秒，.wav）",
    }
    script = (
        f'set f to choose file with prompt "{prompts.get(kind, "选择文件")}"\n'
        "return POSIX path of f"
    )
    try:
        r = subprocess.run(["osascript", "-e", script],
                           capture_output=True, text=True, timeout=180)
        return jsonify({"path": r.stdout.strip() if r.returncode == 0 else ""})
    except Exception:
        return jsonify({"path": ""})

"""Routes for /api/send, /api/history, /api/clear, /api/stop"""
import base64, io, time, json as _json, subprocess, platform
from pathlib import Path
from datetime import datetime
from flask import Blueprint, request, jsonify, Response, stream_with_context
from ..config import load_config
from ..skills import load_skill_persona
from ..ai import call_skill, split_message, CLAUDE_CLI_FORMAT_INSTRUCTION
from ..ai import _get_mode as ai_get_mode
from ..ai import _get_claude_cli, _get_permission_mode, _get_cc_workdir
from ..history import load as load_history, save as save_history, clear as clear_history
from ..claude_session import get_session, create_session, close_session

chat_bp = Blueprint("chat", __name__)
MAX_FILE_CHARS = 100000


def _extract_text_from_file(b64_content, filename, mime_type):
    raw = base64.b64decode(b64_content)
    ext = Path(filename).suffix.lower()
    if mime_type and mime_type.startswith("text/"):
        try:
            return raw.decode("utf-8", errors="replace"), "utf-8"
        except Exception:
            pass
    if ext == ".docx":
        try:
            from docx import Document
            doc = Document(io.BytesIO(raw))
            text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
            return text or "(DOCX 文件无可提取文本)", "python-docx"
        except ImportError:
            return "(需要 pip install python-docx 来读取 .docx 文件)", "missing-lib"
        except Exception as e:
            return f"(DOCX 解析失败: {e})", "error"
    if ext == ".pdf":
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(io.BytesIO(raw))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
            return text or "(PDF 无可提取文本层)", "PyPDF2"
        except ImportError:
            return "(需要 pip install PyPDF2 来读取 .pdf 文件)", "missing-lib"
        except Exception as e:
            return f"(PDF 解析失败: {e})", "error"
    try:
        return raw.decode("utf-8", errors="replace"), "utf-8-fallback"
    except Exception:
        return f"(无法读取此文件类型: {ext or mime_type or '未知'})", "unsupported"


def _compute_history_preview(history_content):
    lines = history_content.split("\n")
    result = []
    file_section = False
    for line in lines:
        if line.startswith("[附件:"):
            file_section = True
            result.append(line[:100])
            continue
        if file_section:
            if len("".join(result)) < 2000:
                result.append(line)
            else:
                if result[-1] != "(内容已截断)":
                    result.append("(内容已截断)")
        else:
            result.append(line)
    return "\n".join(result)


def _sse_event(data):
    return f"data: {_json.dumps(data, ensure_ascii=False)}\n\n"


def _get_tool_uses(event):
    return [c for c in event.get("message", {}).get("content", [])
            if c.get("type") == "tool_use"]


def _cc_stream(session, message, history, skill_id):
    """Read events from session, stream as SSE. Saves history incrementally."""
    for event in session.send(message):
        if event.get("type") == "user":
            continue  # tool_result events — CC handles these internally
        if event.get("type") == "assistant":
            tools = _get_tool_uses(event)
            if tools:
                yield _sse_event({
                    "type": "tool_use",
                    "tools": [{"id": t["id"], "name": t.get("name", "?"),
                               "input": t.get("input", {})} for t in tools],
                })
                save_history(skill_id, history)
            for c in event.get("message", {}).get("content", []):
                if c.get("type") == "text":
                    for msg_line in split_message(c["text"]):
                        ts = datetime.now().strftime("%H:%M")
                        history.append({"sender": "bot", "content": msg_line, "time": ts, "timestamp": time.time()})
                        yield _sse_event({"type": "text", "content": msg_line, "time": ts})
            if any(c.get("type") == "text" for c in event.get("message", {}).get("content", [])):
                save_history(skill_id, history)

        elif event.get("type") == "result":
            yield _sse_event({"type": "done"})
            break

        elif event.get("type") == "error":
            history.append({"sender": "bot", "content": f"[错误] {event['content']}",
                            "time": datetime.now().strftime("%H:%M"), "timestamp": time.time()})
            save_history(skill_id, history)
            yield _sse_event({"type": "error", "content": event["content"]})
            yield _sse_event({"type": "done"})
            break


# ---- Routes ----

@chat_bp.route("/api/history/<skill_id>")
def api_history(skill_id):
    return jsonify(load_history(skill_id))


@chat_bp.route("/api/history/<skill_id>/delete", methods=["POST"])
def api_delete_message(skill_id):
    data = request.json or {}
    idx = data.get("index")
    if idx is None:
        return jsonify({"error": "缺少索引"}), 400
    history = load_history(skill_id)
    if 0 <= idx < len(history):
        history[idx]["deleted"] = True
    save_history(skill_id, history)
    return jsonify({"ok": True})


@chat_bp.route("/api/clear/<skill_id>", methods=["POST"])
def api_clear(skill_id):
    clear_history(skill_id)
    return jsonify({"ok": True})


@chat_bp.route("/api/clear_session/<skill_id>", methods=["POST"])
def api_clear_session(skill_id):
    close_session(skill_id)
    return jsonify({"ok": True})


@chat_bp.route("/api/stop/<skill_id>", methods=["POST"])
def api_stop(skill_id):
    close_session(skill_id)
    return jsonify({"ok": True})


@chat_bp.route("/api/pick_files", methods=["POST"])
def api_pick_files():
    """Open native file picker (macOS / Linux) and return absolute paths."""
    data = request.json or {}
    paths = []
    if platform.system() == "Darwin":
        pick_folders = data.get("folders") if data else None
        cmd = "choose folder" if pick_folders else "choose file"
        script = (
            f'set fileList to {cmd} with multiple selections allowed\n'
            'set pathList to {}\n'
            'repeat with aFile in fileList\n'
            'set end of pathList to POSIX path of aFile\n'
            'end repeat\n'
            'set AppleScript\'s text item delimiters to "\\n"\n'
            'return pathList as text'
        )
        try:
            r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=120)
            if r.returncode == 0 and r.stdout.strip():
                paths = [p.strip() for p in r.stdout.strip().split("\n") if p.strip()]
            elif r.stderr.strip():
                print(f"[pick_files] osascript: {r.stderr.strip()}")
        except Exception as e:
            print(f"[pick_files] err: {e}")
    elif platform.system() == "Linux":
        for cmd in ([["zenity", "--file-selection", "--multiple", "--separator=\n"]],
                     [["kdialog", "--getopenfilename", "--multiple"]]):
            try:
                r = subprocess.run(cmd[0], capture_output=True, text=True, timeout=60)
                if r.returncode == 0 and r.stdout.strip():
                    paths = [p.strip() for p in r.stdout.strip().split("\n") if p.strip()]
                    break
            except Exception:
                continue
    return jsonify({"paths": paths})


@chat_bp.route("/api/send/<skill_id>", methods=["POST"])
def api_send(skill_id):
    data = request.json or {}
    message = data.get("message", "").strip()
    if not message:
        return jsonify({"error": "empty message"}), 400
    if len(message) > 100000:
        return jsonify({"error": "message too long"}), 400

    cfg = load_config()
    contact = next((s for s in cfg["skills"] if s["id"] == skill_id), None)
    if not contact:
        return jsonify({"error": "skill not found"}), 404

    persona = load_skill_persona(contact["skill_name"])
    if not persona:
        return jsonify({"error": f"skill file not found: {contact['skill_name']}"}), 500

    history = load_history(skill_id)
    ts = datetime.now().strftime("%H:%M")
    now_ts = time.time()

    history_content = message
    api_message = message

    mode = ai_get_mode()
    if mode != "claude":
        files_data = data.get("files") or (data.get("file") and [data["file"]]) or []
        if files_data:
            fctx_parts = []
            for fd in files_data:
                fname = fd.get("name", "unknown")
                fmime = fd.get("mime", "")
                fb64 = fd.get("content", "")
                extracted, method = _extract_text_from_file(fb64, fname, fmime)
                extracted = extracted[:MAX_FILE_CHARS]
                fctx_parts.append(f"\n\n[附件: {fname}]\n{extracted}")
            api_message = message + "".join(fctx_parts)
            history_content = _compute_history_preview(message + "".join(fctx_parts))

    history.append({"sender": "user", "content": history_content, "time": ts, "timestamp": now_ts})

    if mode == "claude":
        cli_path = _get_claude_cli()
        perm_mode = _get_permission_mode()
        workdir = _get_cc_workdir()
        full_system = CLAUDE_CLI_FORMAT_INSTRUCTION + persona

        session = get_session(skill_id)
        if session and not session.running:
            close_session(skill_id)
            session = None
        if not session:
            try:
                session = create_session(skill_id, full_system, cli_path, perm_mode, working_dir=workdir)
            except FileNotFoundError as e:
                return jsonify({"error": f"Claude Code CLI 未找到: {e}"}), 500
        elif session._perm_mode != perm_mode:
            session.switch_permission_mode(perm_mode)

        def generate():
            yield from _cc_stream(session, api_message, history, skill_id)
            save_history(skill_id, history)
        return Response(stream_with_context(generate()), mimetype="text/event-stream")

    # API mode
    response = call_skill(persona, api_message, history)
    response_msgs = split_message(response)
    responses = []
    for msg in response_msgs:
        ts2 = datetime.now().strftime("%H:%M")
        history.append({"sender": "bot", "content": msg, "time": ts2, "timestamp": time.time()})
        responses.append({"content": msg, "time": ts2})
    save_history(skill_id, history)
    return jsonify({"user": {"content": message, "time": ts}, "responses": responses})

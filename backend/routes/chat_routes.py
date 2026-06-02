"""Routes for /api/send, /api/history, /api/clear"""
import base64, io, time
from pathlib import Path
from datetime import datetime
from flask import Blueprint, request, jsonify
from ..config import load_config
from ..skills import load_skill_persona
from ..ai import call_skill, split_message
from ..history import load as load_history, save as save_history, clear as clear_history

chat_bp = Blueprint("chat", __name__)

MAX_FILE_CHARS = 100000  # truncation limit for extracted text


def _extract_text_from_file(b64_content, filename, mime_type):
    """Try to extract text from a base64-encoded file. Returns (text, method)."""
    raw = base64.b64decode(b64_content)
    ext = Path(filename).suffix.lower()

    # Plain text: just decode
    if mime_type and mime_type.startswith("text/"):
        try:
            return raw.decode("utf-8", errors="replace"), "utf-8"
        except Exception:
            pass

    # DOCX
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

    # PDF
    if ext == ".pdf":
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(io.BytesIO(raw))
            text = "\n".join(
                page.extract_text() or "" for page in reader.pages
            )
            return text or "(PDF 无可提取文本层)", "PyPDF2"
        except ImportError:
            return "(需要 pip install PyPDF2 来读取 .pdf 文件)", "missing-lib"
        except Exception as e:
            return f"(PDF 解析失败: {e})", "error"

    # Fallback: try UTF-8 decode
    try:
        return raw.decode("utf-8", errors="replace"), "utf-8-fallback"
    except Exception:
        return f"(无法读取此文件类型: {ext or mime_type or '未知'})", "unsupported"


def _compute_history_preview(history_content):
    """Truncate for history storage: keep the message, truncate file content."""
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


@chat_bp.route("/api/history/<skill_id>")
def api_history(skill_id):
    return jsonify(load_history(skill_id))


@chat_bp.route("/api/clear/<skill_id>", methods=["POST"])
def api_clear(skill_id):
    clear_history(skill_id)
    return jsonify({"ok": True})


@chat_bp.route("/api/send/<skill_id>", methods=["POST"])
def api_send(skill_id):
    data = request.json or {}
    message = data.get("message", "").strip()
    file_data = data.get("file")
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
        fctx = "".join(fctx_parts)
        api_message = message + fctx
        history_content = _compute_history_preview(message + fctx)

    history.append({"sender": "user", "content": history_content, "time": ts, "timestamp": now_ts})

    response = call_skill(persona, api_message, history)
    response_msgs = split_message(response)

    responses = []
    for msg in response_msgs:
        ts2 = datetime.now().strftime("%H:%M")
        history.append({"sender": "bot", "content": msg, "time": ts2, "timestamp": time.time()})
        responses.append({"content": msg, "time": ts2})

    save_history(skill_id, history)
    return jsonify({"user": {"content": message, "time": ts}, "responses": responses})

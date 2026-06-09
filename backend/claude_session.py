"""Persistent Claude Code session — one subprocess per chat, stream-json I/O.
Supports --resume for session persistence across server restarts."""
import subprocess, json, threading, queue, shutil, uuid
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
HISTORY_DIR = BASE_DIR / "chat_history"
HISTORY_DIR.mkdir(exist_ok=True)

_sessions = {}
_lock = threading.Lock()


def _session_file(chat_id):
    return HISTORY_DIR / f"{chat_id}_cc.json"


def _load_persisted_session(chat_id, current_workdir=None):
    p = _session_file(chat_id)
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            sid = data.get("session_id")
            saved_wd = data.get("workdir", "")
            if current_workdir and saved_wd and saved_wd != current_workdir:
                return None  # workdir changed, can't resume across directories
            return sid
        except Exception:
            pass
    return None


def _save_persisted_session(chat_id, session_id, workdir=None):
    data = {"session_id": session_id}
    if workdir:
        data["workdir"] = workdir
    _session_file(chat_id).write_text(json.dumps(data), encoding="utf-8")


def _clear_persisted_session(chat_id):
    try:
        p = _session_file(chat_id)
        if p.exists():
            p.unlink()
    except Exception:
        pass


def get_session(chat_id):
    with _lock:
        return _sessions.get(chat_id)


def create_session(chat_id, system_prompt, cli_path="ccb", permission_mode="auto",
                   working_dir=None):
    with _lock:
        _close_locked(chat_id)
        resume_id = _load_persisted_session(chat_id, working_dir)
        s = _ClaudeSession(chat_id, system_prompt, cli_path, permission_mode,
                           working_dir, resume_id)
        _sessions[chat_id] = s
        return s


def close_session(chat_id):
    with _lock:
        _close_locked(chat_id)
        _clear_persisted_session(chat_id)


def close_all_sessions():
    """Close all active CC sessions and clear ALL persisted session files.
    Next message to any contact starts fresh."""
    with _lock:
        for chat_id in list(_sessions.keys()):
            _close_locked(chat_id)
    # Clear ALL persisted files, not just active sessions
    for p in HISTORY_DIR.glob("*_cc.json"):
        try:
            p.unlink()
        except Exception:
            pass


def _close_locked(chat_id):
    s = _sessions.pop(chat_id, None)
    if s:
        s._close()


class _ClaudeSession:
    def __init__(self, chat_id, system_prompt, cli_path, permission_mode,
                 working_dir, resume_id=None):
        self.chat_id = chat_id
        self.event_queue = queue.Queue()
        self.running = True
        self.session_id = resume_id
        self._perm_mode = permission_mode
        self._workdir = working_dir
        self._start(system_prompt, cli_path, permission_mode, working_dir, resume_id)

    def _start(self, system_prompt, cli_path, permission_mode, working_dir, resume_id):
        bin_path = shutil.which(cli_path)
        if not bin_path:
            raise FileNotFoundError(f"未找到: {cli_path}")

        cwd = working_dir or str(Path(__file__).parent.parent)

        # bypassPermissions / dontAsk as CLI flags trigger --dangerously-skip-permissions
        # crash. Launch with auto then switch via control_request during init (safe:
        # no conversation yet, so no orphaned tool_use).
        _SWITCH_MODES = {"bypassPermissions", "dontAsk"}
        launch_mode = permission_mode
        if permission_mode in _SWITCH_MODES:
            launch_mode = "auto"

        def _launch(rid):
            cmd = [bin_path]
            if rid:
                cmd += ["--resume", rid]
            cmd += [
                "--permission-mode", launch_mode,
                "--output-format", "stream-json",
                "--input-format", "stream-json",
                "--verbose",
                "--print",
            ]
            if system_prompt:
                cmd += ["--append-system-prompt", system_prompt]
            return subprocess.Popen(
                cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, bufsize=1, cwd=cwd,
            )

        self.proc = _launch(resume_id)
        self._reader_thread = threading.Thread(target=self._reader, daemon=True)
        self._reader_thread.start()
        self._stderr_thread = threading.Thread(target=self._drain_stderr, daemon=True)
        self._stderr_thread.start()

        # If resume failed (process died within 2s), retry without --resume.
        # Common causes: workdir changed, session corrupted, --bare flag mismatch.
        if resume_id:
            import time as _t
            _t.sleep(2)
            if self.proc.poll() is not None:
                _clear_persisted_session(self.chat_id)
                self.session_id = None
                self.proc = _launch(None)
                if self.proc:
                    self._reader_thread = threading.Thread(target=self._reader, daemon=True)
                    self._reader_thread.start()
                    self._stderr_thread = threading.Thread(target=self._drain_stderr, daemon=True)
                    self._stderr_thread.start()

    def _drain_stderr(self):
        """Continuously drain stderr to prevent pipe buffer deadlock."""
        try:
            while self.running and self.proc and self.proc.stderr:
                chunk = self.proc.stderr.read(4096)
                if not chunk:
                    break
        except Exception:
            pass

    def _reader(self):
        try:
            for line in self.proc.stdout:
                if not self.running:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    self.event_queue.put(json.loads(line))
                except json.JSONDecodeError:
                    pass
        except Exception:
            pass

    def _wait_events(self):
        """Read events from queue until result, error, or subprocess death."""
        skip_result = False
        while self.running:
            if self.proc and self.proc.poll() is not None:
                self.running = False
                try:
                    while True:
                        evt = self.event_queue.get_nowait()
                        if evt.get("type") in ("result", "error"):
                            yield evt
                            return
                        yield evt
                except queue.Empty:
                    pass
                yield {"type": "error", "content": f"Claude Code 进程已退出 (code {self.proc.returncode})"}
                return

            try:
                event = self.event_queue.get(timeout=0.5)

                if event.get("type") == "system":
                    if event.get("subtype") == "init":
                        sid = event.get("session_id", "")
                        if sid and sid != self.session_id:
                            self.session_id = sid
                            _save_persisted_session(self.chat_id, sid, self._workdir)
                        # If we launched with auto but want bypassPermissions/dontAsk, switch now
                        if self._perm_mode in ("bypassPermissions", "dontAsk"):
                            try:
                                ctrl = json.dumps({
                                    "type": "control_request",
                                    "request_id": str(uuid.uuid4()),
                                    "request": {
                                        "subtype": "set_permission_mode",
                                        "mode": self._perm_mode,
                                    }
                                }) + "\n"
                                self.proc.stdin.write(ctrl)
                                self.proc.stdin.flush()
                            except Exception:
                                pass
                    continue

                if event.get("type") in ("result", "error"):
                    if skip_result:
                        skip_result = False
                        continue
                    yield event
                    return

                if event.get("type") == "user":
                    yield event
                elif event.get("type") == "assistant":
                    # Detect recoverable API 400 "tool_use without tool_result".
                    # CC's auto-mode classifier internally denies risky tools, leaving
                    # orphaned tool_use blocks. The next API call hits 400. A retry
                    # with a blank message always recovers — CC cleans up internally.
                    # Suppress the 400 from the frontend and auto-retry transparently.
                    text = "".join(
                        c.get("text", "") for c in event.get("message", {}).get("content", [])
                        if c.get("type") == "text"
                    )
                    # API 400: "tool_use ids were found without tool_result blocks"
                    # CC wraps `tool_use` and `tool_result` in backticks, so check
                    # each keyword independently.
                    if ("tool_use" in text and "without" in text and
                            "tool_result" in text and "invalid_request_error" in text):
                        print(f"[CC:{self.chat_id}] 400 suppressed, auto-retry")
                        retry = json.dumps({
                            "type": "user",
                            "message": {"role": "user", "content": [{"type": "text", "text": " "}]}
                        }, ensure_ascii=False) + "\n"
                        try:
                            self.proc.stdin.write(retry)
                            self.proc.stdin.flush()
                        except Exception:
                            pass
                        skip_result = True
                        continue
                    yield event
                elif event.get("type") == "control_request":
                    # CC in pipe mode sends control_request when it can't auto-decide
                    # (rare, but possible). Auto-deny so CC cleanly removes the
                    # tool_use block instead of leaving an orphan that causes 400.
                    rid = event.get("request_id", "")
                    if rid:
                        resp = json.dumps({
                            "type": "control_response",
                            "response": {
                                "subtype": "error",
                                "request_id": rid,
                                "error": "Auto-denied in pipe mode."
                            }
                        }, ensure_ascii=False) + "\n"
                        try:
                            self.proc.stdin.write(resp)
                            self.proc.stdin.flush()
                        except Exception:
                            pass

            except queue.Empty:
                continue

    def switch_permission_mode(self, new_mode):
        """Send control_request to change CC's permission mode on the fly.
        Must be called right before send() when CC is idle and waiting for input."""
        if not self.running or not self.proc or self.proc.poll() is not None:
            return False
        try:
            ctrl = json.dumps({
                "type": "control_request",
                "request_id": str(uuid.uuid4()),
                "request": {
                    "subtype": "set_permission_mode",
                    "mode": new_mode,
                }
            }) + "\n"
            self.proc.stdin.write(ctrl)
            self.proc.stdin.flush()
            self._perm_mode = new_mode
            return True
        except Exception:
            return False

    def send(self, message):
        if not self.running:
            _clear_persisted_session(self.chat_id)
            yield {"type": "error", "content": "会话已断开，请重新发送消息"}
            return

        content = [{"type": "text", "text": message}]
        msg = json.dumps({
            "type": "user",
            "message": {"role": "user", "content": content}
        }, ensure_ascii=False) + "\n"

        try:
            self.proc.stdin.write(msg)
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError):
            self.running = False
            yield {"type": "error", "content": "Claude Code 进程已断开"}
            return

        yield from self._wait_events()

    def _close(self):
        self.running = False
        try:
            if self.proc and self.proc.poll() is None:
                # Graceful shutdown: close stdin so CC saves state and exits
                try:
                    self.proc.stdin.close()
                except Exception:
                    pass
                try:
                    self.proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.proc.terminate()
                    try:
                        self.proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        self.proc.kill()
        except Exception:
            pass
        self.proc = None

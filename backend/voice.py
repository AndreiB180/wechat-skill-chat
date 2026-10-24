"""本机 GPT-SoVITS 语音合成。

全部跑在这台 Mac 上，不依赖任何局域网服务：主应用把 voice_worker.py 作为子进程
拉起，模型常驻内存，之后每条消息只是一次 127.0.0.1 的本地 HTTP 调用。
（M3 Pro 纯 CPU 实测：约 7 秒合成 5 秒语音，模型冷启动约 10 秒。）

每个联系人独立配置，并且必须先「测试成功」才允许启用 —— verified 由后端在真正
合成出音频后置位，前端改不了这个门槛。
"""
import hashlib, io, json, os, random, socket, subprocess, sys, threading, time, wave, contextlib
from pathlib import Path

from .config import locked_read, locked_write

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None

BASE_DIR = Path(__file__).parent.parent
VOICE_CONFIG_FILE = BASE_DIR / "voice_config.json"
CACHE_DIR = BASE_DIR / "static" / "voice_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
WORKER_SCRIPT = BASE_DIR / "voice_worker.py"
WORKER_LOG = BASE_DIR / "cc_logs" / "voice_worker.log"

DEFAULT_ENGINE = {
    "gpt_sovits_dir": "~/GPT-SoVITS",
    "python": sys.executable or "python3",
    "device": "cpu",  # M3 上 MPS 对这套模型不稳，默认 CPU（实测已够快）
}

_proc = None
_port = None
_proc_lock = threading.Lock()
SYNTH_TIMEOUT = 300


# ---------- 配置 ----------
def load_voice_config():
    cfg = locked_read(VOICE_CONFIG_FILE) or {}
    cfg.setdefault("voices", {})
    cfg["engine"] = {**DEFAULT_ENGINE, **(cfg.get("engine") or {})}
    return cfg


def save_voice_config(cfg):
    locked_write(VOICE_CONFIG_FILE, cfg)


def get_voice(skill_id, require_enabled=True):
    v = load_voice_config()["voices"].get(skill_id)
    if not v:
        return None
    if require_enabled and not (v.get("enabled") and v.get("verified")):
        return None
    if not all(v.get(k) for k in ("gpt_weights", "sovits_weights", "ref_audio")):
        return None
    return v


def has_voice(skill_id):
    return get_voice(skill_id) is not None


def should_speak(skill_id):
    """按配置的概率决定这条消息发不发语音。100 = 一定发语音。"""
    v = get_voice(skill_id)
    if not v:
        return False
    try:
        p = int(v.get("probability", 100))
    except (TypeError, ValueError):
        p = 100
    p = max(0, min(100, p))
    return p >= 100 or (p > 0 and random.randint(1, 100) <= p)


# ---------- 常驻引擎 ----------
def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _alive():
    return _proc is not None and _proc.poll() is None


def engine_status():
    if not _alive():
        return {"running": False}
    try:
        r = requests.get(f"http://127.0.0.1:{_port}/health", timeout=3)
        return {"running": True, "port": _port, **r.json()}
    except Exception:
        return {"running": True, "port": _port, "healthy": False}


def ensure_engine():
    """确保推理进程活着。返回 (port, error)。"""
    global _proc, _port
    if requests is None:
        return None, "缺少依赖 requests"

    with _proc_lock:
        if _alive():
            return _port, None

        cfg = load_voice_config()["engine"]
        gs_dir = Path(os.path.expanduser(cfg["gpt_sovits_dir"]))
        if not gs_dir.is_dir():
            return None, f"找不到 GPT-SoVITS 目录：{gs_dir}"
        if not (gs_dir / "GPT_SoVITS").is_dir():
            return None, f"{gs_dir} 看起来不是 GPT-SoVITS 仓库"

        port = _free_port()
        WORKER_LOG.parent.mkdir(parents=True, exist_ok=True)
        log = open(WORKER_LOG, "ab", buffering=0)
        env = {**os.environ, "TTS_DEVICE": cfg.get("device", "cpu")}
        try:
            _proc = subprocess.Popen(
                [cfg.get("python") or sys.executable, str(WORKER_SCRIPT),
                 "--port", str(port), "--gpt-sovits-dir", str(gs_dir)],
                stdout=log, stderr=log, env=env,
            )
        except Exception as e:
            return None, f"启动语音引擎失败：{e}"

        # 只等 HTTP 端口起来，模型是首次合成时才加载的
        deadline = time.time() + 30
        while time.time() < deadline:
            if _proc.poll() is not None:
                return None, f"语音引擎启动即退出，看 {WORKER_LOG.name}"
            try:
                if requests.get(f"http://127.0.0.1:{port}/health", timeout=1).ok:
                    _port = port
                    return port, None
            except Exception:
                time.sleep(0.3)
        stop_engine()
        return None, "语音引擎启动超时"


def stop_engine():
    global _proc, _port
    with _proc_lock:
        if _proc is not None and _proc.poll() is None:
            _proc.terminate()
            try:
                _proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _proc.kill()
        _proc, _port = None, None


# ---------- 合成 ----------
def wav_duration(data):
    try:
        src = io.BytesIO(data) if isinstance(data, bytes) else str(data)
        with contextlib.closing(wave.open(src, "rb")) as w:
            if w.getframerate():
                return max(1, round(w.getnframes() / float(w.getframerate())))
    except Exception:
        pass
    return 1


def _cache_path(text, v):
    key = "|".join([text, v.get("gpt_weights", ""), v.get("sovits_weights", ""),
                    v.get("ref_audio", ""), v.get("ref_text", ""), str(v.get("speed", 1.0))])
    return CACHE_DIR / (hashlib.sha1(key.encode("utf-8")).hexdigest() + ".wav")


def synthesize_with(voice, text):
    """用给定的一套语音参数合成。返回 (缓存文件名, 秒数, 错误)。"""
    text = (text or "").strip()
    if not text:
        return None, 0, "文本为空"

    for key, label in (("gpt_weights", "GPT 模型"), ("sovits_weights", "SoVITS 模型"),
                       ("ref_audio", "参考音频")):
        p = voice.get(key)
        if not p:
            return None, 0, f"未选择{label}"
        if not Path(os.path.expanduser(p)).exists():
            return None, 0, f"{label}文件不存在：{p}"

    cache = _cache_path(text, voice)
    if cache.exists() and cache.stat().st_size > 44:
        return cache.name, wav_duration(cache), None

    port, err = ensure_engine()
    if err:
        return None, 0, err

    payload = {
        "text": text,
        "gpt": os.path.expanduser(voice["gpt_weights"]),
        "sovits": os.path.expanduser(voice["sovits_weights"]),
        "ref_audio": os.path.expanduser(voice["ref_audio"]),
        "ref_text": voice.get("ref_text", ""),
        "lang": voice.get("lang", "zh"),
        "ref_lang": voice.get("ref_lang", "zh"),
        "speed": voice.get("speed", 1.0),
    }
    try:
        r = requests.post(f"http://127.0.0.1:{port}/synth", json=payload, timeout=SYNTH_TIMEOUT)
    except requests.exceptions.Timeout:
        return None, 0, "合成超时"
    except Exception as e:
        return None, 0, f"语音引擎无响应：{e}"

    if r.status_code != 200:
        try:
            return None, 0, r.json().get("error", f"HTTP {r.status_code}")
        except Exception:
            return None, 0, f"HTTP {r.status_code}"

    data = r.content
    if len(data) <= 44:
        return None, 0, "引擎返回了空音频"
    cache.write_bytes(data)
    return cache.name, wav_duration(data), None


def synthesize(skill_id, text):
    voice = get_voice(skill_id)
    if not voice:
        return None, 0, "该联系人未启用语音"
    return synthesize_with(voice, text)

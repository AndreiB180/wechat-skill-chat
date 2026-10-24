#!/usr/bin/env python3
"""GPT-SoVITS 常驻推理进程 —— 由主应用作为子进程拉起，全部跑在本机。

为什么单开一个进程，而不是在 Flask 里直接 import：
  1. GPT-SoVITS 的若干模块依赖 os.getcwd() 指向它自己的目录，主应用不能 chdir；
  2. 模型几个 GB、冷启动十几秒，必须常驻复用，不能每条消息重载；
  3. torch 崩了不该把整个聊天应用一起拖走。

协议：本地 HTTP，只监听 127.0.0.1。
  GET  /health              -> {"ok":true,"loaded":{...}}
  POST /synth  {text,...}   -> audio/wav 二进制
"""
import argparse, io, json, os, sys, threading, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_engine = None          # TTS 实例
_loaded = {"gpt": None, "sovits": None, "version": None}
_lock = threading.Lock()  # torch 推理不是线程安全的，全局串行
GPT_SOVITS_DIR = None


def _bootstrap(gpt_sovits_dir):
    """切目录 + 修 torchaudio，必须在 import GPT_SoVITS 之前做完。"""
    global GPT_SOVITS_DIR
    GPT_SOVITS_DIR = os.path.expanduser(gpt_sovits_dir)
    os.chdir(GPT_SOVITS_DIR)
    for p in (GPT_SOVITS_DIR,
              os.path.join(GPT_SOVITS_DIR, "GPT_SoVITS"),
              os.path.join(GPT_SOVITS_DIR, "GPT_SoVITS", "eres2net")):
        if p not in sys.path:
            sys.path.insert(0, p)

    # torchaudio 2.9 在 macOS 上要 torchcodec + ffmpeg@7，而本机是 ffmpeg@8，
    # 直接用 librosa 顶替 torchaudio.load。（这个补丁来自用户已跑通的 tts.py）
    import torch
    import torchaudio as _ta
    import librosa as _librosa

    def _patched_load(path, *a, **kw):
        audio, sr = _librosa.load(path, sr=None)
        return torch.from_numpy(audio).unsqueeze(0), sr

    _ta.load = _patched_load


def _detect_version(sovits_path):
    try:
        from GPT_SoVITS.process_ckpt import get_sovits_version_from_path_fast
        res = get_sovits_version_from_path_fast(sovits_path)
        # 返回 (version, model_version, if_lora)，我们要的是 model_version
        if isinstance(res, (list, tuple)) and len(res) >= 2 and res[1]:
            return res[1]
    except Exception:
        pass
    return "v2ProPlus"


def _ensure_engine(gpt, sovits):
    """按需加载/切换权重。同一套已在内存里就直接复用。"""
    global _engine
    if _engine is not None and _loaded["gpt"] == gpt and _loaded["sovits"] == sovits:
        return

    from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config

    version = _detect_version(sovits)
    pre = os.path.join(GPT_SOVITS_DIR, "GPT_SoVITS/pretrained_models")

    if _engine is not None and _loaded["version"] == version:
        # 同版本可以热切换，省下重载 BERT / HuBERT 的十几秒
        if _loaded["sovits"] != sovits:
            _engine.init_vits_weights(sovits)
        if _loaded["gpt"] != gpt:
            _engine.init_t2s_weights(gpt)
    else:
        cfg = TTS_Config({"custom": {
            "device": os.environ.get("TTS_DEVICE", "cpu"),
            "is_half": False,
            "version": version,
            "t2s_weights_path": gpt,
            "vits_weights_path": sovits,
            "cnhuhbert_base_path": os.path.join(pre, "chinese-hubert-base"),
            "bert_base_path": os.path.join(pre, "chinese-roberta-wwm-ext-large"),
        }})
        _engine = TTS(cfg)

    _loaded.update({"gpt": gpt, "sovits": sovits, "version": version})


def _synthesize(req):
    import numpy as np
    import soundfile as sf

    _ensure_engine(req["gpt"], req["sovits"])
    inputs = {
        "text": req["text"],
        "text_lang": req.get("lang", "zh"),
        "ref_audio_path": req["ref_audio"],
        "prompt_text": req.get("ref_text", "") or "",
        "prompt_lang": req.get("ref_lang", "zh"),
        "top_k": int(req.get("top_k", 15)),
        "top_p": float(req.get("top_p", 1.0)),
        "temperature": float(req.get("temperature", 1.0)),
        "text_split_method": req.get("split_method", "cut5"),
        "batch_size": 1,
        "speed_factor": float(req.get("speed", 1.0)),
        "fragment_interval": 0.3,
        "seed": -1,
        "parallel_infer": True,
        "repetition_penalty": 1.35,
        "streaming_mode": False,
    }
    sr, audio = None, None
    for sr, audio in _engine.run(inputs):
        pass
    if audio is None:
        raise RuntimeError("模型没有返回音频")
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # 静音访问日志，模型自己的输出已经够多了
        pass

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "loaded": dict(_loaded)})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/synth":
            self._json(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            self._json(400, {"error": f"请求解析失败: {e}"})
            return

        for k in ("text", "gpt", "sovits", "ref_audio"):
            if not req.get(k):
                self._json(400, {"error": f"缺少参数 {k}"})
                return

        try:
            with _lock:
                wav = _synthesize(req)
        except Exception as e:
            traceback.print_exc()
            self._json(500, {"error": f"{type(e).__name__}: {e}"})
            return

        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav)))
        self.end_headers()
        self.wfile.write(wav)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--gpt-sovits-dir", default="~/GPT-SoVITS")
    args = ap.parse_args()

    _bootstrap(args.gpt_sovits_dir)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[voice_worker] listening on 127.0.0.1:{args.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()

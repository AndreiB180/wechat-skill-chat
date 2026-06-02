"""Anthropic/DeepSeek API client and skill-calling logic."""
import os, base64
from .config import load_settings

try:
    from anthropic import Anthropic, APIStatusError, APITimeoutError
except ImportError:
    Anthropic = None
    APIStatusError = Exception
    APITimeoutError = Exception


def _deobfuscate(s):
    try:
        return base64.b64decode(s).decode()
    except Exception:
        return s


def _get_api_key():
    s = load_settings()
    key = s.get("api_key", "")
    if key.startswith("obf:"):
        return _deobfuscate(key[4:])
    return key or os.environ.get("ANTHROPIC_API_KEY", "")


def _get_base_url():
    return load_settings().get("base_url", "")


def _get_model():
    return load_settings().get("model", "")


def _get_client():
    key = _get_api_key()
    if not key or not Anthropic:
        return None
    kwargs = {"api_key": key, "timeout": 60.0, "max_retries": 1}
    base = _get_base_url()
    if base:
        kwargs["base_url"] = base
    return Anthropic(**kwargs)


WECHAT_FORMAT_INSTRUCTION = (
    "【CRITICAL - 最高优先级】你正在模拟微信聊天。严格遵守："
    "1. 绝对禁止使用 Markdown 语法——没有人会在微信里打 # * ** ~~ ` ``` 这些东西。你就是普通人在打字。"
    "2. 绝对禁止使用角色动作描写，如\"（顿了顿）\"\"（推了推眼镜）\"\"（叹气）\"等括号动作描述。"
    "3. 绝对禁止在消息中使用旁白、叙述性文字、场景描述。你只能输出这个人会在微信里打出来的纯文字。"
    "4. 表情用英文方括号，如[捂脸][旺柴][流泪][玫瑰][破涕为笑]。"
    "5. 每条消息必须像真人微信聊天：简短、口语化、没有剧本感。\n\n"
)


def call_skill(system_prompt, message, history):
    client = _get_client()
    if not client:
        return "[错误] 未设置 API Key。请在设置中填写。"
    model = _get_model()
    if not model:
        return "[错误] 未设置 Model。请在设置中填写。"

    system_prompt = WECHAT_FORMAT_INSTRUCTION + system_prompt

    messages = []
    for h in history[-20:]:
        role = "assistant" if h["sender"] != "user" else "user"
        content = h.get("content", "")
        if role == "assistant" and content.startswith("[错误]"):
            continue
        messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})

    try:
        response = client.messages.create(
            model=model, max_tokens=1024,
            system=system_prompt, messages=messages,
        )
        for block in response.content:
            if hasattr(block, "text"):
                return block.text
        return "[错误] 模型返回了空响应"
    except APITimeoutError:
        return "[错误] API 请求超时，请重试。"
    except Exception as e:
        return f"[错误] {str(e)}"


def split_message(text):
    lines = text.strip().split("\n")
    msgs = [l.strip() for l in lines if l.strip()]
    return msgs if msgs else [text.strip()]

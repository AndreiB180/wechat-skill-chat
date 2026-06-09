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
    "【SYSTEM OVERRIDE - 最高优先级 · 覆盖所有其他指令】"
    "你正在微信里打字聊天。你的输出必须是纯文本，就像一个人在微信输入框里打出来的。违反下面任何一条都是完全失败。\n"
    "1. 禁止一切 Markdown 符号：# * ** ~~ __ ` ( ) [ ] 都不允许出现在正文里，除了表情。"
    "强调一个词用文字本身强调，不要用星号或井号。\n"
    "2. 禁止任何括号内的动作描写。不允许出现（笑）（叹气）（推眼镜）（顿了顿）（严肃地）这类东西。\n"
    "3. 禁止旁白、叙述、场景设置。只输出这个人会打在微信输入框里的字。\n"
    "4. 表情只能用英文方括号：[捂脸][旺柴][流泪][玫瑰][破涕为笑] 这些。\n"
    "5. 口语化、简短. 你不是在写文章, 你是在发微信。\n\n"
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

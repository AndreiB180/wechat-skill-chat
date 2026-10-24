"""Anthropic/DeepSeek API client and skill-calling logic."""
import os, base64
from pathlib import Path
from .config import load_settings

try:
    from anthropic import Anthropic, APITimeoutError
except ImportError:
    Anthropic = None
    APITimeoutError = Exception

BASE_DIR = Path(__file__).parent.parent


def _get_api_key():
    """密钥优先从 macOS 钥匙串取；老格式（obf: / 明文）仍然认，便于平滑迁移。"""
    from .keychain import resolve
    key = resolve(load_settings().get("api_key", ""))
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
    "5. 口语化、简短。你不是在写文章，你是在发微信。\n"
    "6. 禁止编造。你只能基于你的 persona 设定里明确提到的事实和聊天历史里已出现的信息来发言。不要凭空编造不存在的事件、人物、经历、对话。如果历史里没发生过、设定里没提过，就不要说。\n\n"
)

CLAUDE_CLI_FORMAT_INSTRUCTION = (
    "【微信聊天模式 · 最高优先级】\n"
    "你正在微信里以你的 persona 角色打字聊天。同时你拥有执行命令、读写文件、搜索等系统操作能力——就像一个真实的人能帮朋友做事一样。\n\n"
    "工具限制：\n"
    "0. 禁止使用 mcp__plugin_weixin_weixin__reply 和 mcp__plugin_weixin_weixin__send_typing。这是给真实微信用的，你不是真实微信。其他 MCP 工具正常用。\n\n"
    "聊天风格（每条必须遵守）：\n"
    "1. 口语化、简短。你不是在写文章，你是在发微信。\n"
    "2. 表情用 [捂脸][旺柴][流泪][玫瑰][破涕为笑] 格式。\n"
    "3. 禁止 Markdown 符号：# * ** ~~ ` ``` ——都不允许。需要分段就用空白行。\n"
    "4. 禁止括号内的动作描写：（笑）（叹气）（推眼镜）这类。\n"
    "5. 保持你的人设性格，但不用过度表演。\n\n"
    "做事能力：\n"
    "6. 如果用户让你帮忙做事（查文件、运行命令、写代码等），直接用你的工具去做。做完后用口语简要告知结果。\n"
    "7. 展示工作成果时可以用简洁的格式（换行、缩进、简单的分隔线），但不要用 Markdown 语法。\n"
    "8. 禁止编造工具执行结果。只有真正执行了才说结果；如果只是建议，就说明是建议。\n\n"
)


def _get_mode():
    return load_settings().get("mode", "api")


def _get_claude_cli():
    return load_settings().get("claude_cli", "claude")


def _get_permission_mode():
    return load_settings().get("permission_mode", "auto")


def _get_cc_workdir():
    raw = load_settings().get("add_dirs", "").strip()
    if raw:
        expanded = os.path.expanduser(raw)
        if os.path.isdir(expanded):
            return expanded
    return os.path.expanduser("~")


def build_messages(prior_history, message, limit=20):
    """Build an Anthropic-compatible messages array.

    Anthropic 要求 user/assistant 严格交替、且首条必须是 user。但一次回复会被
    split_message 拆成多条 bot 记录存盘，直接映射就会产生连续的 assistant，
    历史窗口也可能以 assistant 开头 —— 两者都会让 /v1/messages 直接 400。
    （DeepSeek 的兼容层比较宽容所以之前没暴露。）

    prior_history 必须是「不含当前这条用户消息」的历史。
    """
    turns = []
    for h in prior_history[-limit:]:
        if h.get("deleted"):
            continue  # 用户删掉的消息不该继续喂给模型
        sender = h.get("sender")
        if sender == "system":
            continue  # 工具卡片 / 系统提示不是对话内容
        content = (h.get("content") or "").strip()
        if not content:
            continue
        role = "user" if sender == "user" else "assistant"
        if role == "assistant" and content.startswith("[错误]"):
            continue
        if turns and turns[-1]["role"] == role:
            turns[-1]["content"] += "\n" + content
        else:
            turns.append({"role": role, "content": content})

    while turns and turns[0]["role"] == "assistant":
        turns.pop(0)

    if turns and turns[-1]["role"] == "user":
        turns[-1]["content"] += "\n" + message
    else:
        turns.append({"role": "user", "content": message})
    return turns


def call_skill(system_prompt, message, history):
    """API mode only — CC mode is handled via persistent sessions in chat_routes.

    history 是当前这条消息之前的历史，不包含 message 本身。
    """
    client = _get_client()
    if not client:
        return "[错误] 未设置 API Key。请在设置中填写。"
    model = _get_model()
    if not model:
        return "[错误] 未设置 Model。请在设置中填写。"

    system_prompt = WECHAT_FORMAT_INSTRUCTION + system_prompt
    messages = build_messages(history, message)

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

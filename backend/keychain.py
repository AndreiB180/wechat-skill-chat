"""macOS Keychain 存取 API Key。

原来密钥是 base64 混淆后写在 settings.json 里 —— base64 可逆，等于明文，
任何拿到这个文件夹的人都能还原。改成存进登录钥匙串，settings.json 里只留一个
`keychain:` 标记。

Keychain 不可用时（非 macOS、被拒绝、命令缺失）自动回退到原来的混淆方式，
不阻塞使用，只是安全性回到从前。
"""
import base64, platform, subprocess

SERVICE = "wechat-skill-chat"
ACCOUNT = "api_key"
MARKER = "keychain:"
OBF_PREFIX = "obf:"


def available():
    return platform.system() == "Darwin"


def set_secret(value, service=SERVICE, account=ACCOUNT):
    """写入钥匙串（已存在则覆盖）。成功返回 True。"""
    if not available() or not value:
        return False
    try:
        subprocess.run(
            ["security", "add-generic-password", "-U",
             "-s", service, "-a", account, "-w", value],
            capture_output=True, text=True, timeout=15, check=True,
        )
        return True
    except Exception:
        return False


def get_secret(service=SERVICE, account=ACCOUNT):
    """读回密钥，没有或失败返回空串。"""
    if not available():
        return ""
    try:
        r = subprocess.run(
            ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
            capture_output=True, text=True, timeout=15,
        )
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


def delete_secret(service=SERVICE, account=ACCOUNT):
    if not available():
        return False
    try:
        subprocess.run(["security", "delete-generic-password",
                        "-s", service, "-a", account],
                       capture_output=True, text=True, timeout=15)
        return True
    except Exception:
        return False


# ---- 与 settings.json 的兼容层 ----
def obfuscate(s):
    return OBF_PREFIX + base64.b64encode(s.encode()).decode()


def deobfuscate(s):
    try:
        return base64.b64decode(s[len(OBF_PREFIX):]).decode()
    except Exception:
        return ""


def store(value):
    """存密钥，返回该写进 settings.json 的字符串。"""
    if set_secret(value):
        return MARKER
    return obfuscate(value)   # 回退：还是混淆存文件


def resolve(stored):
    """把 settings.json 里存的值还原成真实密钥。"""
    if not stored:
        return ""
    if stored == MARKER or stored.startswith(MARKER):
        return get_secret()
    if stored.startswith(OBF_PREFIX):
        return deobfuscate(stored)
    return stored   # 更早的明文

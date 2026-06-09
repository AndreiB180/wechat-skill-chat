"""Claude Code CLI availability check."""
import subprocess, shutil


def check_claude_cli(cli_path="ccb"):
    """Check if the Claude Code CLI is available and working. Returns (ok, version_or_error)."""
    bin_path = shutil.which(cli_path)
    if not bin_path:
        return False, f"未找到命令: {cli_path}"
    try:
        result = subprocess.run(
            [bin_path, "--version"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            version = result.stdout.strip() or result.stderr.strip() or "ok"
            return True, version.split("\n")[0][:100]
        return False, f"退出码: {result.returncode}"
    except FileNotFoundError:
        return False, f"未找到命令: {cli_path}"
    except subprocess.TimeoutExpired:
        return False, "检测超时"
    except Exception as e:
        return False, str(e)

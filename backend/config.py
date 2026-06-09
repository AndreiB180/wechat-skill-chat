"""Settings & skills_config CRUD with file locking."""
import json, fcntl
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
SETTINGS_FILE = BASE_DIR / "settings.json"
CONFIG_FILE = BASE_DIR / "skills_config.json"


def locked_read(path):
    if not path.exists():
        return None
    if path.stat().st_size == 0:
        return None
    with open(path, "r", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_SH)
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return None
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def locked_write(path, data):
    with open(path, "w", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            json.dump(data, f, ensure_ascii=False, indent=2)
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


# ---- Settings ----
def load_settings():
    return locked_read(SETTINGS_FILE) or {}


def save_settings(data):
    locked_write(SETTINGS_FILE, data)


# ---- Skills Config ----
def load_config():
    return locked_read(CONFIG_FILE) or {"skills": []}


def save_config(cfg):
    locked_write(CONFIG_FILE, cfg)

"""Skill persona loading (project-local first, then system installs)."""
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent


def load_skill_persona(skill_name):
    for base in [
        BASE_DIR / "skills",
        Path.home() / ".claude" / "skills",
        Path.home() / ".claude" / "skills" / "dot-skill" / "skills" / "colleague",
    ]:
        for fname in [
            f"{skill_name}.md",
            f"{skill_name}/SKILL.md",
            skill_name.replace("colleague-", "") + "/SKILL.md",
            skill_name.replace("colleague-", "") + ".md",
        ]:
            p = base / fname
            if p.exists():
                return p.read_text(encoding="utf-8")
    return None

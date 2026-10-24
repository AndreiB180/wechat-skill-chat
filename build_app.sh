#!/bin/bash
# 生成 微信.app —— 一个轻量启动器包。
#
# 为什么不用 py2app：这套依赖里有 torch / GPT-SoVITS（几 GB），
# py2app 打包 anaconda 环境本来就容易出问题，把几 GB 模型塞进 .app 更没必要。
# 这里做的是「壳」：真正的运行环境仍是本机 Python，.app 只负责给你一个
# Dock 图标、Launchpad 入口和双击启动。
#
#   ./build_app.sh              # 生成到当前目录
#   ./build_app.sh ~/Applications
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$PROJECT_DIR}"
APP="$OUT_DIR/微信.app"

# 选一个装了 pywebview 的解释器；优先当前 python3
PYBIN="$(command -v python3)"
if ! "$PYBIN" -c "import webview" >/dev/null 2>&1; then
  for c in /opt/anaconda3/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
    if [ -x "$c" ] && "$c" -c "import webview" >/dev/null 2>&1; then PYBIN="$c"; break; fi
  done
fi
if ! "$PYBIN" -c "import webview" >/dev/null 2>&1; then
  echo "找不到装了 pywebview 的 Python。先跑: pip3 install pywebview" >&2
  exit 1
fi
echo "使用解释器: $PYBIN"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# ---- 图标：微信绿底 + 白色对话气泡 ----
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
"$PYBIN" - "$ICONSET" <<'PY'
import sys
from PIL import Image, ImageDraw
out = sys.argv[1]

BG    = (28, 28, 30, 255)     # 深色底（对照 macOS 26 那版微信图标）
GREEN = (7, 193, 96, 255)

def bubble(d, x, y, w, h, fill, tail_left, hole=None):
    """一个带小尾巴的气泡；hole 用于让前面的气泡在后面那个上挖出描边间隙。"""
    d.rounded_rectangle([x, y, x + w, y + h], radius=h * 0.42, fill=fill)
    if tail_left:
        d.polygon([(x + w * 0.16, y + h * 0.80), (x + w * 0.40, y + h * 0.98),
                   (x - w * 0.03, y + h * 1.22)], fill=fill)
    else:
        d.polygon([(x + w * 0.84, y + h * 0.80), (x + w * 0.60, y + h * 0.98),
                   (x + w * 1.03, y + h * 1.22)], fill=fill)

def eyes(d, cx, cy, gap, r, fill):
    for dx in (-gap, gap):
        d.ellipse([cx + dx - r, cy - r, cx + dx + r, cy + r], fill=fill)

def icon(sz):
    S = sz * 8
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=BG)

    # 后面的大气泡（左上）
    bw, bh = S * 0.44, S * 0.355
    bx, by = S * 0.115, S * 0.175
    bubble(d, bx, by, bw, bh, GREEN, tail_left=True)
    eyes(d, bx + bw * 0.5, by + bh * 0.46, bw * 0.145, S * 0.026, BG)

    # 前面的小气泡（右下），先用底色描一圈把两个气泡分开
    sw, sh = S * 0.395, S * 0.32
    sx, sy = S * 0.455, S * 0.435
    pad = S * 0.022
    d.rounded_rectangle([sx - pad, sy - pad, sx + sw + pad, sy + sh + pad],
                        radius=(sh + 2 * pad) * 0.42, fill=BG)
    bubble(d, sx, sy, sw, sh, GREEN, tail_left=False)
    eyes(d, sx + sw * 0.5, sy + sh * 0.44, sw * 0.15, S * 0.024, BG)

    return im.resize((sz, sz), Image.LANCZOS)

for s in (16, 32, 64, 128, 256, 512):
    icon(s).save(f"{out}/icon_{s}x{s}.png")
    icon(s * 2).save(f"{out}/icon_{s}x{s}@2x.png")
PY
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# ---- 启动器 ----
# 启动器必须是**编译出来的原生二进制**，不能用 shell 脚本。
# 走 LaunchServices 启动时，macOS 的 TCC 按「包内主可执行文件」来归属权限；
# 主程序若是脚本，责任链会断在解释器上，读 ~/Documents 会直接
# "Operation not permitted"，而且连授权框都不弹（实测踩过）。
SRC="$(mktemp -d)/launcher.c"
cat > "$SRC" <<EOF
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    const char *home = getenv("HOME");
    char log[1024];
    if (home) {
        snprintf(log, sizeof(log), "%s/Library/Logs/wechat-skill-chat.log", home);
        freopen(log, "a", stdout);
        freopen(log, "a", stderr);
    }
    if (chdir("$PROJECT_DIR") != 0) { perror("chdir"); return 1; }
    execl("$PYBIN", "python3", "$PROJECT_DIR/app_native.py", (char*)NULL);
    perror("execl");
    return 1;
}
EOF
cc -O2 -o "$APP/Contents/MacOS/launcher" "$SRC" || { echo "编译启动器失败（需要 Xcode 命令行工具：xcode-select --install）" >&2; exit 1; }
chmod +x "$APP/Contents/MacOS/launcher"

# ---- Info.plist ----
cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>微信</string>
  <key>CFBundleDisplayName</key><string>微信</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIdentifier</key><string>local.wechat-skill-chat</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSRequiresAquaSystemAppearance</key><false/>
  <key>NSMicrophoneUsageDescription</key><string>用于语音消息。</string>
  <key>NSDocumentsFolderUsageDescription</key><string>聊天记录和人格文件存放在这里。</string>
  <key>NSDownloadsFolderUsageDescription</key><string>用于读取导入的语音模型文件。</string>
</dict>
</plist>
EOF

# 必须签名：走 LaunchServices 启动的未签名 App 拿不到 ~/Documents 的访问权限，
# 会直接 "Operation not permitted" 读不到脚本，而且不会弹授权框。
# ad-hoc 签名给它一个稳定身份，系统才会在首次启动时询问。
codesign --force --deep --sign - "$APP" 2>/dev/null && echo "已 ad-hoc 签名" || echo "签名失败（可继续，但可能读不到 Documents）"

touch "$APP"
echo "已生成: $APP"
echo
echo "首次启动会弹「访问「文稿」文件夹」的授权框 —— 必须点「允许」，否则读不到项目文件。"
echo "若被 Gatekeeper 拦，右键点「打开」一次即可。"

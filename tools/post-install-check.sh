#!/usr/bin/env bash
# 重登之后跑一遍，逐项自检
set -uo pipefail

UUID="quick-panel-tweaks@xiaomingming92.github.io"
EXT="$HOME/.local/share/gnome-shell/extensions/$UUID"
CFG="$HOME/.config/$UUID/config.json"

echo "── 1. 安装位置"
[ -d "$EXT" ] && ls -1 "$EXT" | sed 's/^/   /' || echo "   ✗ 未安装，先跑 make install"

echo "── 2. Shell 是否已加载"
if gnome-extensions list 2>/dev/null | grep -q "$UUID"; then
    gnome-extensions info "$UUID" | grep -E "^  (Name|Enabled|State)" | sed 's/^/   /'
else
    echo "   ✗ 尚未加载 —— 注销重新登录一次（Wayland 无法热加载）"
fi

echo "── 3. 是否在启用列表"
gsettings get org.gnome.shell enabled-extensions | tr ',' '\n' | grep -q "$UUID" \
    && echo "   ✓ 已在 enabled-extensions" || echo "   ✗ 不在启用列表（gnome-extensions enable $UUID）"

echo "── 4. 配置文件"
[ -f "$CFG" ] && python3 -m json.tool "$CFG" | sed 's/^/   /' \
    || echo "   （还没有配置文件，打开一次设置窗口或等扩展写入默认值）"

echo "── 5. 最近日志（扩展自身输出）"
journalctl --user -b -o cat 2>/dev/null | grep -iE "quick-panel-tweaks|quick tweaks" | tail -15 | sed 's/^/   /' \
    || echo "   （无）"

echo "── 6. 快捷面板里的系统栏结构（需要 python3 + gi）"
python3 - <<'PY' 2>/dev/null | sed 's/^/   /' || echo "   （跳过：本机 python3 没有 gi，忽略）"
import gi
gi.require_version('Gio', '2.0')
print("提示：系统栏结构只能在 Shell 进程内检查，跳过")
PY

echo
echo "预期效果：面板底行 = [电池] …… [录屏][截图][设置][锁屏][关机]"

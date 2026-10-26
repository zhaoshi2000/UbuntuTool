#!/usr/bin/env bash
set -euo pipefail
if ((EUID == 0)); then echo '请以安装扩展的桌面用户运行卸载脚本。' >&2; exit 1; fi
UUID='ubuntutool@zhaoshi2000'
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$DATA_HOME/gnome-shell/extensions/$UUID"
if [[ ! -d "$DEST" || -L "$DEST" ]]; then echo '未找到普通目录形式的 UbuntuTool 安装。' >&2; exit 1; fi
gnome-extensions disable "$UUID" 2>/dev/null || true
gjs -m "$DEST/restore-profile.js"
python3 - "$UUID" <<'PY'
import gi, sys
from gi.repository import Gio
s = Gio.Settings.new('org.gnome.shell')
for key in ('enabled-extensions', 'disabled-extensions'):
    s.set_strv(key, [x for x in s.get_strv(key) if x != sys.argv[1]])
Gio.Settings.sync()
PY
rm -rf -- "$DEST"
rm -f -- "$HOME/.local/bin/ubuntutool" "$DATA_HOME/applications/ubuntutool.desktop"
echo 'UbuntuTool 已卸载，借用的系统快捷键已恢复。'
echo "剪贴板数据保留在 $DATA_HOME/ubuntutool；如需删除，请先在设置中清空历史。"
echo "异常退出遗留的截图缓存可能位于 ${XDG_CACHE_HOME:-$HOME/.cache}/ubuntutool/captures。"

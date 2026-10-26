#!/usr/bin/env bash
set -euo pipefail
UUID='ubuntutool@zhaoshi2000'
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENABLE=1
TARGET_USER=''
UPDATED=0
while (($#)); do
    case "$1" in
        --no-enable) ENABLE=0 ;;
        --user) shift; TARGET_USER="${1:?--user requires a username}" ;;
        *) echo "Usage: $0 [--no-enable] [--user USER]" >&2; exit 2 ;;
    esac
    shift
done
if ((EUID == 0)); then
    if [[ -z "$TARGET_USER" || "$TARGET_USER" == root ]]; then
        echo 'UbuntuTool 必须安装到实际桌面用户。请使用普通用户运行，或显式指定 --user xh。' >&2
        exit 1
    fi
    TARGET_UID="$(id -u "$TARGET_USER")"
    TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
    ARGS=(); ((ENABLE)) || ARGS+=(--no-enable)
    exec runuser -u "$TARGET_USER" -- env HOME="$TARGET_HOME" \
        XDG_RUNTIME_DIR="/run/user/$TARGET_UID" \
        DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$TARGET_UID/bus" \
        bash "$ROOT/scripts/install.sh" "${ARGS[@]}"
fi
for tool in gnome-shell gnome-extensions glib-compile-schemas gsettings gjs; do
    command -v "$tool" >/dev/null || { echo "缺少 $tool。需要 Ubuntu GNOME 桌面及 libglib2.0-bin、gjs。" >&2; exit 1; }
done
VERSION="$(gnome-shell --version | grep -oE '[0-9]+' | head -n1)"
case "$VERSION" in 46|47|48|49|50) ;; *) echo "当前 GNOME $VERSION 不受支持；需要 46–50。" >&2; exit 1 ;; esac
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
EXTENSIONS="$DATA_HOME/gnome-shell/extensions"
DEST="$EXTENSIONS/$UUID"
mkdir -p -- "$EXTENSIONS" "$HOME/.local/bin" "$DATA_HOME/applications"
STAGE="$(mktemp -d "$EXTENSIONS/.ubuntutool-stage.XXXXXXXX")"
trap '[[ -z "${STAGE:-}" ]] || rm -rf -- "$STAGE"' EXIT
cp -R -- "$ROOT/extension/." "$STAGE/"
cp -- "$ROOT/LICENSE" "$STAGE/LICENSE"
glib-compile-schemas --strict "$STAGE/schemas"
if [[ -L "$DEST" ]]; then echo '扩展目录是符号链接，停止安装以保留现有内容。' >&2; exit 1; fi
if [[ -d "$DEST" ]]; then
    UPDATED=1
    gnome-extensions disable "$UUID" 2>/dev/null || true
    # Also recover borrowed shortcuts if a prior Shell crash prevented disable().
    gjs -m "$DEST/restore-profile.js" || { echo '旧快捷键备份未能恢复，停止更新。' >&2; exit 1; }
    BACKUP="$DATA_HOME/ubuntutool-backups/$(date +%Y%m%d-%H%M%S)-$$"
    mkdir -p -- "$(dirname -- "$BACKUP")"
    mv -- "$DEST" "$BACKUP"
    echo "旧版本备份：$BACKUP"
fi
mv -- "$STAGE" "$DEST"
STAGE=''
install -m 755 "$ROOT/scripts/ubuntutool" "$HOME/.local/bin/ubuntutool"
cat > "$DATA_HOME/applications/ubuntutool.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=UbuntuTool
Comment=快捷工具箱、剪贴板与截图标注
Exec="$HOME/.local/bin/ubuntutool"
Icon=applications-utilities-symbolic
Terminal=false
Categories=Utility;Settings;
DESKTOP
if ((ENABLE)); then
    if gnome-extensions enable "$UUID" 2>/dev/null; then
        if ((UPDATED)); then
            echo 'UbuntuTool 更新文件已安装。GNOME 会缓存旧版扩展代码，请注销并重新登录后使用新增功能。'
        else
            echo 'UbuntuTool 已启用。Win+Shift+T 打开工具箱，Alt+A 截图标注，Win+V 打开剪贴板。'
        fi
    else
        # GNOME Wayland may not discover a newly copied extension until the next session.
        python3 - "$UUID" <<'PY'
import gi, sys
from gi.repository import Gio
s = Gio.Settings.new('org.gnome.shell')
uuid = sys.argv[1]
s.set_strv('enabled-extensions', list(dict.fromkeys([*s.get_strv('enabled-extensions'), uuid])))
s.set_strv('disabled-extensions', [x for x in s.get_strv('disabled-extensions') if x != uuid])
Gio.Settings.sync()
PY
        echo '安装完成。新扩展尚未被当前 GNOME 会话发现，请注销后重新登录（无需重启机器）。'
    fi
else
    echo '安装完成；暂未启用。注销登录后运行：gnome-extensions enable ubuntutool@zhaoshi2000'
fi
echo "源文件：$DEST"

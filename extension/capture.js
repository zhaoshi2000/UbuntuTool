import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Screenshot from 'resource:///org/gnome/shell/ui/screenshot.js';

export function captureDirectory() {
    const path = GLib.build_filenamev([GLib.get_user_cache_dir(), 'ubuntutool', 'captures']);
    GLib.mkdir_with_parents(path, 0o700);
    GLib.chmod(GLib.path_get_dirname(path), 0o700);
    GLib.chmod(path, 0o700);
    return path;
}

export class CaptureController {
    constructor(extension) {
        this.extension = extension;
        this.busy = false;
        this.alive = true;
        this.selector = null;
        this._cleanupOldFiles();
    }

    _cleanupOldFiles() {
        const folder = Gio.File.new_for_path(captureDirectory());
        const iterator = folder.enumerate_children('standard::name,time::modified', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        try {
            let info;
            while ((info = iterator.next_file(null))) {
                if (/^(capture|export|clipboard)-[0-9a-f-]{36}\.(png|jpg|webp)$/.test(info.get_name()) &&
                    info.get_attribute_uint64('time::modified') < Date.now() / 1000 - 7 * 86400) {
                    try { folder.get_child(info.get_name()).delete(null); } catch (_) { /* retry next launch */ }
                }
            }
        } finally { iterator.close(null); }
    }

    async start() {
        if (this.busy || !this.alive || Main.sessionMode.isLocked) return;
        this.busy = true;
        try {
            this.selector = new Screenshot.SelectArea();
            const hint = new St.Label({text: '拖动框选截图区域 · 松开后标注 · Esc 取消', style_class: 'ut-capture-hint', x: 24, y: 55});
            this.selector.add_child(hint);
            let rectangle;
            if (typeof this.selector.selectAsync === 'function') {
                rectangle = await this.selector.selectAsync();
            } else {
                // Older supported Shell releases use a finished signal instead of selectAsync.
                rectangle = await new Promise(resolve => {
                    this.selector.connect('finished', (_selector, result) => resolve(result));
                    this.selector.show();
                });
            }
            this.selector = null;
            if (!rectangle || !this.alive || Main.sessionMode.isLocked) return;
            await this.capture(rectangle);
        } catch (error) {
            if (this.alive && !error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Main.notifyError('UbuntuTool 截图', error.message);
        } finally { this.busy = false; }
    }

    async capture(rectangle) {
        if (!this.alive || Main.sessionMode.isLocked) return;
        const {x, y, width, height} = rectangle;
        if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 3 || height < 3 ||
            width * height > 64000000 || x + width > global.stage.width || y + height > global.stage.height)
            throw new Error('请选择有效矩形区域（最大 6400 万像素）。');
        // SelectArea hides its rubberband before completing. Yield one frame so it is not captured.
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            resolve(); return GLib.SOURCE_REMOVE;
        }));
        if (!this.alive) return;
        const file = Gio.File.new_for_path(`${captureDirectory()}/capture-${GLib.uuid_string_random()}.png`);
        const stream = file.create(Gio.FileCreateFlags.PRIVATE, null);
        try {
            const shooter = new Shell.Screenshot();
            await shooter.screenshot_area(x, y, width, height, stream);
            stream.close(null);
            if (!this.alive || Main.sessionMode.isLocked) {
                file.delete(null); return;
            }
            Gio.Subprocess.new(['gjs', '-m', `${this.extension.path}/app/main.js`, '--edit', file.get_path(), '--temporary'], Gio.SubprocessFlags.NONE);
        } catch (error) {
            try { stream.close(null); } catch (_) { /* already closed */ }
            try { file.delete(null); } catch (_) { /* failed capture */ }
            throw error;
        }
    }

    destroy() {
        this.alive = false;
        if (this.selector) {
            this.selector._grabHelper?.ungrab();
            this.selector.destroy();
            this.selector = null;
        }
    }
}

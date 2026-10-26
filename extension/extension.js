import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ACTIONS} from './core/catalog.js';
import {HistoryModel, chooseMime, MAX_IMAGE_BYTES, MAX_TEXT_BYTES} from './core/history.js';
import {HistoryStorage} from './storage.js';
import {ShortcutManager} from './shortcuts.js';
import {ClipboardPanel} from './panel.js';
import {CaptureController, captureDirectory} from './capture.js';

export default class UbuntuToolExtension extends Extension {
    enable() {
        try {
            this._enable();
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    _enable() {
        this._alive = true;
        this._generation = 0;
        this._sources = new Set();
        this._settings = this.getSettings();
        this._storage = new HistoryStorage();
        this._model = new HistoryModel({limit: this._settings.get_int('history-limit'), retentionDays: this._settings.get_int('retention-days')});
        this._model.load(this._settings.get_boolean('persist-history') ? this._storage.load() : []);
        this._clipboard = St.Clipboard.get_default();
        this._selection = global.display.get_selection();
        this._previousWindow = global.display.focus_window;
        this._panel = new ClipboardPanel(this, this._model, this._storage, this._settings, entry => this._select(entry));
        this._shortcuts = new ShortcutManager(this._settings, action => this._activate(action));
        this._captureController = new CaptureController(this);
        // Requests from a previous login are not replayed unexpectedly.
        this._settings.set_string('tool-request', '');
        this._shortcuts.rebuild();
        this._settingsSignal = this._settings.connect('changed', (_settings, key) => this._settingsChanged(key));
        for (const key of this._settings.settings_schema.list_keys()) this._settings.get_value(key);
        this._focusSignal = global.display.connect('notify::focus-window', () => {
            if (global.display.focus_window && !this._panel.indicator.menu.isOpen)
                this._previousWindow = global.display.focus_window;
        });
        this._selectionSignal = this._selection.connect('owner-changed', (_selection, type) => {
            if (type !== Meta.SelectionType.SELECTION_CLIPBOARD)
                return;
            this._readCancellable?.cancel();
            const generation = ++this._generation;
            this._later(120, () => {
                if (generation === this._generation)
                    this._capture(generation);
            });
        });
        this._later(250, () => this._capture(this._generation));
        if (this._settings.get_string('clear-request')) this._settingsChanged('clear-request');
        this.historyChanged();
    }

    _later(milliseconds, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            this._sources.delete(id);
            if (this._alive) callback();
            return GLib.SOURCE_REMOVE;
        });
        this._sources.add(id);
        return id;
    }

    _read(mime, limit) {
        const cancellable = new Gio.Cancellable();
        this._readCancellable = cancellable;
        const output = Gio.MemoryOutputStream.new_resizable();
        const timeout = this._later(5000, () => cancellable.cancel());
        return new Promise((resolve, reject) => {
            this._selection.transfer_async(Meta.SelectionType.SELECTION_CLIPBOARD, mime, limit + 1,
                output, cancellable, (source, result) => {
                    if (this._sources.delete(timeout)) GLib.source_remove(timeout);
                    try {
                        source.transfer_finish(result);
                        output.close(null);
                        if (output.get_data_size() > limit) {
                            reject(new Error('Clipboard item is too large'));
                            return;
                        }
                        resolve(output.steal_as_bytes());
                    } catch (error) {
                        try { output.close(null); } catch (_) { /* already closed */ }
                        reject(error);
                    }
                });
        });
    }

    async _capture(generation) {
        if (!this._alive || this._settings.get_boolean('paused') || Main.sessionMode.isLocked)
            return;
        const mime = chooseMime(this._selection.get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD) ?? []);
        if (!mime || (mime.startsWith('image/') && !this._settings.get_boolean('capture-images')))
            return;
        try {
            const image = mime.startsWith('image/');
            const bytes = await this._read(mime, image ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES);
            if (!this._alive || generation !== this._generation || !bytes.get_size() || this._settings.get_boolean('paused'))
                return;
            const id = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes);
            const now = Date.now();
            const entry = {id, kind: image ? 'image' : 'text', mime, byteSize: bytes.get_size(), createdAt: now, updatedAt: now, pinned: false};
            if (image) {
                const suffix = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}[mime];
                entry.imageName = `${id}.${suffix}`;
                await this._storage.writeImage(entry.imageName, bytes);
                if (!this._alive || generation !== this._generation)
                    return;
            } else {
                // Reject broken UTF-8 rather than silently changing the data pasted later.
                entry.text = new TextDecoder('utf-8', {fatal: true}).decode(bytes.get_data());
                entry.mime = 'text/plain';
                if (!entry.text.trim())
                    return;
            }
            this._model.add(entry);
            this.historyChanged();
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.debug(`[UbuntuTool] Clipboard item skipped: ${error.message}`);
        }
    }

    historyChanged() {
        if (!this._alive)
            return;
        this._storage.schedule(this._model.entries, this._settings.get_boolean('persist-history'));
        if (this._panel.indicator.menu.isOpen)
            this._panel.render();
    }

    _select(entry) {
        const target = this._previousWindow ?? global.display.focus_window;
        try {
            if (entry.kind === 'image')
                this._clipboard.set_content(St.ClipboardType.CLIPBOARD, entry.mime, this._storage.readImage(entry.imageName));
            else
                this._clipboard.set_text(St.ClipboardType.CLIPBOARD, entry.text);
            this._panel.close();
            this._model.add({...entry, updatedAt: Date.now()});
            this.historyChanged();
            if (this._settings.get_boolean('auto-paste') && target) {
                target.activate(global.get_current_time());
                this._later(160, () => {
                    // Do not paste into another window if the user changed focus during the delay.
                    if (global.display.focus_window === target && !Main.sessionMode.isLocked)
                        this._paste();
                });
            }
        } catch (error) {
            Main.notifyError('UbuntuTool', `无法恢复剪贴板内容：${error.message}`);
        }
    }

    _paste() {
        const seat = global.stage.context.get_backend().get_default_seat();
        this._virtualKeyboard ??= seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const time = GLib.get_monotonic_time();
        this._virtualKeyboard.notify_keyval(time, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
        try {
            this._virtualKeyboard.notify_keyval(time + 1, Clutter.KEY_v, Clutter.KeyState.PRESSED);
            this._virtualKeyboard.notify_keyval(time + 2, Clutter.KEY_v, Clutter.KeyState.RELEASED);
        } finally {
            this._virtualKeyboard.notify_keyval(time + 3, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        }
    }

    _settingsChanged(key) {
        if (key === 'tool-request') {
            this._handleToolRequest();
            return;
        }
        if (ACTIONS.some(action => action.key === key) || ['windows-profile', 'custom-shortcuts', 'system-overrides'].includes(key))
            this._shortcuts.rebuild();
        if (['history-limit', 'retention-days'].includes(key)) {
            this._model.limit = this._settings.get_int('history-limit');
            this._model.retentionDays = this._settings.get_int('retention-days');
            this._model.prune();
            this.historyChanged();
        }
        if (key === 'persist-history') this.historyChanged();
        if (key === 'clear-request') {
            const request = this._settings.get_string('clear-request');
            if (!request) return;
            this._model.clear(request.startsWith('unpinned:'));
            this.historyChanged();
            this._settings.set_string('clear-request', '');
        }
        if (key === 'auto-paste') this._panel.render();
        if (key === 'paused') {
            this._readCancellable?.cancel();
            this._generation++;
        }
    }

    _launch(names, fallback = null) {
        for (const name of names) {
            const app = Shell.AppSystem.get_default().lookup_app(name);
            if (app) { app.activate(); return; }
        }
        if (fallback && GLib.find_program_in_path(fallback)) {
            Gio.Subprocess.new([fallback], Gio.SubprocessFlags.NONE);
            return;
        }
        Main.notify('UbuntuTool', `未安装对应应用：${names[0]}。可在设置中改为自定义命令。`);
    }

    _handleToolRequest() {
        const raw = this._settings.get_string('tool-request');
        if (!raw) return;
        this._settings.set_string('tool-request', '');
        let request;
        try {
            request = JSON.parse(raw);
            if (typeof request.id !== 'string' || request.id.length > 64 || Main.sessionMode.isLocked)
                throw new Error('工具请求无效。');
            if (request.action === 'copy-image') {
                const path = request.path;
                if (typeof path !== 'string' || GLib.path_get_dirname(path) !== captureDirectory() ||
                    !/^export-[0-9a-f-]{36}\.png$/.test(GLib.path_get_basename(path)))
                    throw new Error('图片不在工具截图目录中。');
                const file = Gio.File.new_for_path(path);
                const info = file.query_info('standard::size,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
                if (info.get_file_type() !== Gio.FileType.REGULAR || info.get_size() > MAX_IMAGE_BYTES)
                    throw new Error('复制图片最多 20 MB，请使用保存图片。');
                const [, bytes] = file.load_contents(null);
                const signature = [137, 80, 78, 71, 13, 10, 26, 10];
                if (!signature.every((value, i) => bytes[i] === value)) throw new Error('截图不是 PNG 图片。');
                this._clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', new GLib.Bytes(bytes));
                file.delete(null);
            } else if (['clipboard', 'screenshot', 'toolbox', 'preferences'].includes(request.action)) {
                if (request.action === 'preferences') this.openPreferences();
                else this._activate(request.action);
            } else throw new Error('不支持的工具操作。');
            this._settings.set_string('tool-result', JSON.stringify({id: request.id, ok: true}));
        } catch (error) {
            this._settings.set_string('tool-result', JSON.stringify({id: request?.id ?? '', ok: false, error: error.message}));
        }
    }

    _activate(action) {
        try {
            switch (action) {
            case 'toolbox': Gio.Subprocess.new(['gjs', '-m', `${this.path}/app/main.js`], Gio.SubprocessFlags.NONE); break;
            case 'screenshot': this._panel.close(); this._captureController.start(); break;
            case 'clipboard':
                if (!this._panel.indicator.menu.isOpen && global.display.focus_window)
                    this._previousWindow = global.display.focus_window;
                this._panel.toggle();
                break;
            case 'files': Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(GLib.get_home_dir(), null), global.create_app_launch_context(0, -1)); break;
            case 'run': Main.openRunDialog(); break;
            case 'settings': this._launch(['org.gnome.Settings.desktop'], 'gnome-control-center'); break;
            case 'search': Main.overview.show(); break;
            case 'quick-settings': Main.panel.statusArea.quickSettings.menu.toggle(); break;
            case 'task-manager': this._launch(['org.gnome.SystemMonitor.desktop', 'gnome-system-monitor.desktop'], 'gnome-system-monitor'); break;
            case 'emoji': this._launch(['org.gnome.Characters.desktop'], 'gnome-characters'); break;
            case 'minimize-all':
                this._minimizedWindows = global.workspace_manager.get_active_workspace().list_windows()
                    .filter(window => !window.minimized && !window.skip_taskbar && window.get_window_type() === Meta.WindowType.NORMAL && window.can_minimize());
                for (const window of this._minimizedWindows) window.minimize();
                break;
            case 'restore-all':
                for (const window of this._minimizedWindows ?? []) {
                    try { window.unminimize(); } catch (_) { /* window may have been closed */ }
                }
                this._minimizedWindows = [];
                break;
            }
        } catch (error) { Main.notifyError('UbuntuTool', error.message); }
    }

    disable() {
        this._alive = false;
        this._generation++;
        this._readCancellable?.cancel();
        if (this._selectionSignal) this._selection.disconnect(this._selectionSignal);
        if (this._settingsSignal) this._settings.disconnect(this._settingsSignal);
        if (this._focusSignal) global.display.disconnect(this._focusSignal);
        for (const id of this._sources ?? []) GLib.source_remove(id);
        this._sources?.clear();
        this._shortcuts?.destroy();
        this._captureController?.destroy();
        this._panel?.destroy();
        this._storage?.close(this._model?.entries ?? [], this._settings?.get_boolean('persist-history') ?? false);
        this._virtualKeyboard = null;
        this._previousWindow = null;
        this._minimizedWindows = null;
        this._panel = null;
        this._shortcuts = null;
        this._captureController = null;
        this._selection = null;
        this._clipboard = null;
        this._settings = null;
        this._readCancellable = null;
    }
}

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {ACTIONS, SYSTEM_MAPPINGS, NATIVE_SHORTCUTS, LIMITATIONS} from './core/catalog.js';
import {normalizeAccelerator} from './core/history.js';

function json(settings, key, fallback) {
    try { return JSON.parse(settings.get_string(key)); } catch (_) { return fallback; }
}

function parseAccelerator(value) {
    if (!value.trim()) return '';
    const [ok, key, modifiers] = Gtk.accelerator_parse(value.trim());
    if (!ok || !Gtk.accelerator_valid(key, modifiers))
        throw new Error('请输入有效组合键，例如 <Super>v、<Control><Alt>t；不要只填写字母。');
    return Gtk.accelerator_name(key, modifiers);
}

function displayAccelerator(value) {
    try {
        const [ok, key, modifiers] = Gtk.accelerator_parse(value);
        return ok ? Gtk.accelerator_get_label(key, modifiers) : value;
    } catch (_) { return value; }
}

function captureShortcut(parent, entry) {
    const dialog = new Gtk.Window({title: '录制快捷键', modal: true, transient_for: parent, default_width: 400, default_height: 180});
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 16, margin_top: 30, margin_bottom: 30, margin_start: 24, margin_end: 24});
    box.append(new Gtk.Label({label: '按下要使用的组合键', css_classes: ['title-2']}));
    box.append(new Gtk.Label({label: 'Esc 取消，Backspace 清空。也可以返回后手动填写。', wrap: true}));
    dialog.set_child(box);
    const controller = new Gtk.EventControllerKey();
    controller.connect('key-pressed', (_controller, key, _code, state) => {
        if (key === Gdk.KEY_Escape) { dialog.close(); return true; }
        if (key === Gdk.KEY_BackSpace) { entry.text = ''; dialog.close(); return true; }
        const mask = Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK |
            Gdk.ModifierType.SHIFT_MASK | Gdk.ModifierType.SUPER_MASK |
            Gdk.ModifierType.META_MASK | Gdk.ModifierType.HYPER_MASK;
        if (!Gtk.accelerator_valid(key, state & mask)) return true;
        entry.text = Gtk.accelerator_name(key, state & mask);
        dialog.close();
        return true;
    });
    dialog.add_controller(controller);
    dialog.connect('map', () => {
        try { dialog.get_surface().inhibit_system_shortcuts(null); } catch (_) { /* manual input remains available */ }
    });
    dialog.connect('close-request', () => {
        try { dialog.get_surface().restore_system_shortcuts(); } catch (_) { /* surface gone */ }
        return false;
    });
    dialog.present();
}

function editBinding(parent, title, initial, save) {
    const dialog = new Gtk.Dialog({title, modal: true, transient_for: parent, default_width: 480});
    dialog.add_button('取消', Gtk.ResponseType.CANCEL);
    dialog.add_button('保存', Gtk.ResponseType.OK);
    const box = dialog.get_content_area();
    box.spacing = 12;
    box.margin_top = box.margin_bottom = box.margin_start = box.margin_end = 24;
    box.append(new Gtk.Label({label: 'Win 键在 Ubuntu 中称为 Super。留空可禁用这项快捷键。', wrap: true, xalign: 0}));
    const row = new Gtk.Box({spacing: 8});
    const entry = new Gtk.Entry({text: initial, placeholder_text: '<Super>v', hexpand: true});
    row.append(entry);
    const record = new Gtk.Button({label: '录制'});
    record.connect('clicked', () => captureShortcut(dialog, entry));
    row.append(record);
    box.append(row);
    const error = new Gtk.Label({wrap: true, xalign: 0, css_classes: ['error']});
    box.append(error);
    dialog.connect('response', (_dialog, response) => {
        if (response === Gtk.ResponseType.OK) {
            try { save(parseAccelerator(entry.text)); } catch (exception) { error.label = exception.message; return; }
        }
        dialog.destroy();
    });
    dialog.present();
}

export default class UbuntuToolPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this.settings = this.getSettings();
        window._settings = this.settings;
        window.set_default_size(820, 740);
        window.title = '快捷工具箱 — UbuntuTool';
        const clipboard = new Adw.PreferencesPage({title: '剪贴板', icon_name: 'edit-paste-symbolic'});
        const shortcuts = new Adw.PreferencesPage({title: 'Windows 快捷键', icon_name: 'input-keyboard-symbolic'});
        const custom = new Adw.PreferencesPage({title: '自定义与说明', icon_name: 'emblem-system-symbolic'});
        window.add(clipboard); window.add(shortcuts); window.add(custom);

        const intro = new Adw.PreferencesGroup({title: '把熟悉的操作带到 Ubuntu', description: '按 Win + V 查看文字、图片和固定记录。历史只保存在本机，不上传、不遥测。'});
        clipboard.add(intro);
        this._bindingRow(intro, window, ACTIONS[0].label, 'Win + V', () => this.settings.get_strv('open-clipboard'), value => this.settings.set_strv('open-clipboard', value ? [value] : []), () => this.settings.reset('open-clipboard'));
        const behavior = new Adw.PreferencesGroup({title: '记录与粘贴', description: '只记录系统剪贴板，不记录鼠标划词。带密码管理器敏感标记的内容会跳过；没有标记的密码无法自动识别。'});
        clipboard.add(behavior);
        this._switch(behavior, 'paused', '暂停记录', '暂停后仍可浏览和粘贴已有记录。');
        this._switch(behavior, 'capture-images', '保留图片', '支持 PNG、JPEG、WebP，单张最大 20 MB。');
        this._switch(behavior, 'rdp-image-compat', '微软远程桌面图片兼容', '复制图片时同时提供原格式与真实 BMP 位图，便于回到 Windows 粘贴。兼容转换最多 1600 万像素，超限仍保留原格式。');
        const remoteStatus = new Adw.ActionRow({title: '远程桌面图片状态', subtitle: this.settings.get_string('rdp-bridge-status') || '在微软远程桌面中开启剪贴板重定向；选择记录旁的复制按钮或按 Ctrl+Enter，仅复制、不向 Ubuntu 窗口粘贴。', subtitle_lines: 0});
        behavior.add(remoteStatus);
        const remoteStatusSignal = this.settings.connect('changed::rdp-bridge-status', () => { remoteStatus.subtitle = this.settings.get_string('rdp-bridge-status') || '下次复制图片时检查兼容提供程序。'; });
        window.connect('close-request', () => { this.settings.disconnect(remoteStatusSignal); return false; });
        this._switch(behavior, 'auto-paste', '选择后自动粘贴', '面板关闭后向原窗口发送 Ctrl+V；终端等使用不同粘贴键的应用请关闭此项并自行粘贴。');
        this._switch(behavior, 'persist-history', '重启后保留历史', '关闭会清除磁盘中的历史索引；本次会话中的图片临时文件在退出后清理。');
        this._spin(behavior, 'history-limit', '历史条数上限', '固定条目优先保留，最多固定 50 条。', 10, 500, 10);
        this._spin(behavior, 'retention-days', '保留天数', '过期的未固定记录自动清理。总内容预算 128 MB。', 1, 365, 1);
        const privacy = new Adw.PreferencesGroup({title: '本机数据', description: '位置：~/.local/share/ubuntutool/。目录仅当前用户可访问。文本单条最多 256 KB；不保存 HTML、文件拖拽或云端历史。'});
        clipboard.add(privacy);
        const erase = new Adw.ActionRow({title: '删除全部历史', subtitle: '包括已固定记录；无法撤销。扩展关闭时，下次启用后执行。'});
        const eraseButton = new Gtk.Button({label: '删除历史', valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
        eraseButton.connect('clicked', () => {
            const dialog = new Adw.MessageDialog({transient_for: window, heading: '删除全部剪贴板历史？', body: '文本、图片和固定记录都会删除。此操作无法撤销。'});
            dialog.add_response('cancel', '取消'); dialog.add_response('delete', '删除全部');
            dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_default_response('cancel'); dialog.set_close_response('cancel');
            dialog.connect('response', (_dialog, response) => {
                if (response === 'delete') this.settings.set_string('clear-request', `all:${Date.now()}`);
                dialog.destroy();
            });
            dialog.present();
        });
        erase.add_suffix(eraseButton); privacy.add(erase);

        const preset = new Adw.PreferencesGroup({title: 'Windows 操作习惯', description: '启用后接管 Windows 系统级组合键。关闭方案或禁用扩展会恢复原设置；后来由你修改过的设置会保留。工具箱、Alt+A 截图、剪贴板和自定义命令独立生效。'});
        shortcuts.add(preset);
        this._switch(preset, 'windows-profile', '启用 Windows 快捷键方案', 'Win 在 Ubuntu 中是 Super；不会重新映射整个 Ctrl 或 Alt 键。');
        const appBindings = new Adw.PreferencesGroup({title: '应用与桌面入口', description: '点组合键可以录制或编辑，点击还原恢复工具默认值。系统监视器和字符表需要安装 gnome-system-monitor / gnome-characters。'});
        shortcuts.add(appBindings);
        for (const action of ACTIONS.slice(1)) {
            this._bindingRow(appBindings, window, action.label, action.windows,
                () => this.settings.get_strv(action.key),
                value => this.settings.set_strv(action.key, value ? [value] : []),
                () => this.settings.reset(action.key));
        }
        const systemBindings = new Adw.PreferencesGroup({title: '窗口与工作区', description: '使用 GNOME 提供的对应操作。缺失或被占用的组合键会在下方报告。'});
        shortcuts.add(systemBindings);
        for (const mapping of SYSTEM_MAPPINGS) {
            const read = () => json(this.settings, 'system-overrides', {})[mapping.key] ?? mapping.value;
            this._bindingRow(systemBindings, window, mapping.label, mapping.note ?? mapping.windows, read, value => {
                const overrides = json(this.settings, 'system-overrides', {});
                overrides[mapping.key] = value ? [value] : [];
                this.settings.set_string('system-overrides', JSON.stringify(overrides));
            }, () => {
                const overrides = json(this.settings, 'system-overrides', {});
                delete overrides[mapping.key]; this.settings.set_string('system-overrides', JSON.stringify(overrides));
            });
        }
        const status = new Adw.PreferencesGroup({title: '快捷键状态'});
        shortcuts.add(status);
        const statusRow = new Adw.ActionRow({title: '正在检查', subtitle_lines: 0});
        status.add(statusRow);
        const updateStatus = () => {
            const problems = json(this.settings, 'shortcut-status', []);
            statusRow.title = problems.length ? `${problems.length} 项需要处理` : '没有检测到组合键冲突';
            statusRow.subtitle = problems.length ? problems.join('\n') : '状态由已启用的扩展更新；扩展关闭时不会执行这些快捷键。';
        };
        const statusSignal = this.settings.connect('changed::shortcut-status', updateStatus);
        window.connect('close-request', () => { this.settings.disconnect(statusSignal); return false; });
        updateStatus();

        const commands = new Adw.PreferencesGroup({title: '自己的快捷键', description: '将任意组合键绑定到当前用户的命令，例如：gnome-terminal。命令以当前桌面用户运行，不使用 root。'});
        custom.add(commands);
        const addRow = new Adw.ActionRow({title: '添加自定义命令'});
        const addButton = new Gtk.Button({icon_name: 'list-add-symbolic', valign: Gtk.Align.CENTER});
        addRow.add_suffix(addButton); commands.add(addRow);
        let commandRows = [];
        const refresh = () => {
            for (const row of commandRows) commands.remove(row);
            commandRows = [];
            const items = json(this.settings, 'custom-shortcuts', []);
            for (const item of items) {
                const row = new Adw.ActionRow({title: item.label || item.command, subtitle: `${displayAccelerator(item.accelerator)} · ${item.command}`});
                const edit = new Gtk.Button({icon_name: 'document-edit-symbolic', valign: Gtk.Align.CENTER, tooltip_text: '编辑'});
                edit.connect('clicked', () => this._editCommand(window, item, refresh));
                row.add_suffix(edit);
                const remove = new Gtk.Button({icon_name: 'edit-delete-symbolic', valign: Gtk.Align.CENTER, tooltip_text: '删除'});
                remove.connect('clicked', () => {
                    this.settings.set_string('custom-shortcuts', JSON.stringify(json(this.settings, 'custom-shortcuts', []).filter(entry => entry.id !== item.id)));
                    refresh();
                });
                row.add_suffix(remove); commands.add(row); commandRows.push(row);
            }
        };
        addButton.connect('clicked', () => this._editCommand(window, null, refresh));
        refresh();
        const native = new Adw.PreferencesGroup({title: 'Ubuntu / 应用已经支持', description: '这些组合键不被全局拦截，实际行为以当前应用为准。'});
        custom.add(native);
        for (const [key, title] of NATIVE_SHORTCUTS) native.add(new Adw.ActionRow({title, subtitle: key}));
        const limits = new Adw.PreferencesGroup({title: '适配边界', description: 'Windows 专有服务和应用内部快捷键无法在 Ubuntu 上保证一对一复现。当前版本面向 GNOME 46–50，GNOME 50 已实机测试。KDE、XFCE 和 GNOME 42 不适用。'});
        custom.add(limits);
        for (const [key, note] of LIMITATIONS) limits.add(new Adw.ActionRow({title: key, subtitle: note, subtitle_lines: 0}));
    }

    _switch(group, key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle, subtitle_lines: 0});
        this.settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
    }

    _spin(group, key, title, subtitle, lower, upper, step) {
        const row = new Adw.SpinRow({title, subtitle, adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5})});
        this.settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
    }

    _bindingRow(group, window, title, subtitle, read, write, reset) {
        const row = new Adw.ActionRow({title, subtitle, subtitle_lines: 0});
        const edit = new Gtk.Button({label: read().map(displayAccelerator).join(' / ') || '已禁用', valign: Gtk.Align.CENTER});
        const update = () => { edit.label = read().map(displayAccelerator).join(' / ') || '已禁用'; };
        edit.connect('clicked', () => editBinding(window, title, read()[0] ?? '', value => { write(value); update(); }));
        row.add_suffix(edit);
        const restore = new Gtk.Button({icon_name: 'edit-undo-symbolic', valign: Gtk.Align.CENTER, tooltip_text: '还原默认值'});
        restore.connect('clicked', () => { reset(); update(); });
        row.add_suffix(restore); group.add(row);
    }

    _editCommand(window, existing, refresh) {
        const dialog = new Gtk.Dialog({title: existing ? '编辑快捷键' : '添加快捷键', modal: true, transient_for: window, default_width: 500});
        dialog.add_button('取消', Gtk.ResponseType.CANCEL); dialog.add_button('保存', Gtk.ResponseType.OK);
        const box = dialog.get_content_area();
        box.spacing = 12; box.margin_top = box.margin_bottom = box.margin_start = box.margin_end = 24;
        const name = new Gtk.Entry({text: existing?.label ?? '', placeholder_text: '名称，例如：终端'});
        const command = new Gtk.Entry({text: existing?.command ?? '', placeholder_text: '命令，例如：gnome-terminal'});
        const accel = new Gtk.Entry({text: existing?.accelerator ?? '', placeholder_text: '组合键，例如：<Super>t', hexpand: true});
        const accelRow = new Gtk.Box({spacing: 8});
        accelRow.append(accel);
        const record = new Gtk.Button({label: '录制'}); record.connect('clicked', () => captureShortcut(dialog, accel)); accelRow.append(record);
        box.append(name); box.append(command); box.append(accelRow);
        const error = new Gtk.Label({wrap: true, xalign: 0, css_classes: ['error']}); box.append(error);
        dialog.connect('response', (_dialog, response) => {
            if (response === Gtk.ResponseType.OK) {
                try {
                    const shortcut = parseAccelerator(accel.text);
                    if (!shortcut || !command.text.trim() || command.text.includes('\0')) throw new Error('请填写组合键和命令。');
                    const items = json(this.settings, 'custom-shortcuts', []);
                    if (!existing && items.length >= 100) throw new Error('最多创建 100 项自定义命令。');
                    if (items.some(item => item.id !== existing?.id && normalizeAccelerator(item.accelerator) === normalizeAccelerator(shortcut)))
                        throw new Error('另一项自定义命令已使用这个组合键。');
                    const item = {id: existing?.id ?? GLib.uuid_string_random(), label: name.text.trim(), command: command.text.trim(), accelerator: shortcut};
                    this.settings.set_string('custom-shortcuts', JSON.stringify([...items.filter(entry => entry.id !== item.id), item]));
                    refresh();
                } catch (exception) { error.label = exception.message; return; }
            }
            dialog.destroy();
        });
        dialog.present();
    }
}

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ACTIONS, SYSTEM_MAPPINGS} from './core/catalog.js';
import {normalizeAccelerator} from './core/history.js';
import {SettingsLedger} from './core/ledger.js';

const SCHEMAS = [
    'org.gnome.desktop.wm.keybindings', 'org.gnome.mutter.keybindings',
    'org.gnome.shell.keybindings', 'org.gnome.mutter.wayland.keybindings',
    'org.gnome.settings-daemon.plugins.media-keys',
];

export class DesktopSettings {
    constructor() { this.settings = new Map(); }
    _get(schema) {
        if (!this.settings.has(schema)) {
            const definition = Gio.SettingsSchemaSource.get_default().lookup(schema, true);
            this.settings.set(schema, definition ? new Gio.Settings({settings_schema: definition}) : null);
        }
        return this.settings.get(schema);
    }
    has(schema, key) {
        const settings = this._get(schema);
        return settings?.settings_schema.has_key(key) && settings.get_value(key).get_type_string() === 'as';
    }
    keys(schema) { return this._get(schema)?.settings_schema.list_keys().filter(key => this.has(schema, key)) ?? []; }
    get(schema, key) { return this._get(schema).get_strv(key); }
    isDefault(schema, key) { return this._get(schema).get_user_value(key) === null; }
    set(schema, key, value) {
        if (!this._get(schema).is_writable(key) || !this._get(schema).set_strv(key, value))
            throw new Error(`Desktop shortcut is not writable: ${key}`);
    }
    reset(schema, key) { this._get(schema).reset(key); }
}

function readJSON(settings, key, fallback) {
    try { return JSON.parse(settings.get_string(key)); } catch (_) { return fallback; }
}

export class ShortcutManager {
    constructor(settings, activate) {
        this.settings = settings;
        this.activate = activate;
        this.adapter = new DesktopSettings();
        this.ledger = new SettingsLedger(this.adapter, readJSON(settings, 'profile-backup', []));
        this.bindings = [];
        this.grabs = new Map();
        this._activationSignal = global.display.connect('accelerator-activated', (_display, action) => {
            const command = this.grabs.get(action);
            if (command && !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter)
                this._launchCommand(command);
        });
    }

    rebuild() {
        this._removeBindings();
        this.ledger.restore();
        const problems = [];
        try {
            const activeActions = ACTIONS.filter(action => action.always || this.settings.get_boolean('windows-profile'));
            const rawCustom = readJSON(this.settings, 'custom-shortcuts', []);
            const custom = (Array.isArray(rawCustom) ? rawCustom : []).filter(item =>
                typeof item?.accelerator === 'string' && typeof item?.command === 'string' && item.command.trim()).slice(0, 100);
            const overrides = readJSON(this.settings, 'system-overrides', {});
            const system = this.settings.get_boolean('windows-profile') ? SYSTEM_MAPPINGS.map(mapping => {
                const value = overrides?.[mapping.key];
                return {...mapping, value: Array.isArray(value) && value.every(v => typeof v === 'string') ? value : mapping.value};
            }) : [];
            const wanted = new Set([
                ...activeActions.flatMap(action => this.settings.get_strv(action.key)),
                ...system.flatMap(mapping => mapping.value), ...custom.map(item => item.accelerator),
            ].filter(Boolean).map(normalizeAccelerator));
            // Borrow conflicting built-in accelerators, retaining every unrelated shortcut.
            for (const schema of SCHEMAS) {
                for (const key of this.adapter.keys(schema)) {
                    if (system.some(mapping => mapping.schema === schema && mapping.key === key))
                        continue;
                    const before = this.adapter.get(schema, key);
                    const after = before.filter(value => !wanted.has(normalizeAccelerator(value)));
                    if (before.length !== after.length)
                        this.ledger.set(schema, key, after);
                }
            }
            for (const mapping of system) {
                if (!this.ledger.set(mapping.schema, mapping.key, mapping.value))
                    problems.push(`${mapping.label}：此 GNOME 版本没有对应系统设置`);
            }
            for (const action of activeActions) {
                if (!this.settings.get_strv(action.key).length)
                    continue;
                const id = Main.wm.addKeybinding(action.key, this.settings, Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this.activate(action.action));
                this.bindings.push(action.key);
                if (id === Meta.KeyBindingAction.NONE)
                    problems.push(`${action.label}：快捷键被其他扩展占用或格式无效`);
            }
            for (const item of custom) {
                const id = global.display.grab_accelerator(item.accelerator, Meta.KeyBindingFlags.NONE);
                if (id === Meta.KeyBindingAction.NONE) {
                    problems.push(`${item.label || item.command}：自定义快捷键被占用或格式无效`);
                    continue;
                }
                Main.wm.allowKeybinding(`external-grab-${id}`, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
                this.grabs.set(id, item.command);
            }
        } catch (error) {
            problems.push(`快捷键配置失败：${error.message}`);
            console.error(`[UbuntuTool] Shortcut setup failed: ${error.message}`);
        }
        this.settings.set_string('profile-backup', JSON.stringify(this.ledger.records));
        this.settings.set_string('shortcut-status', JSON.stringify(problems));
    }

    _launchCommand(command) {
        // The user explicitly configures these commands; no sudo/root or environment rewriting.
        try { Gio.Subprocess.new(['/bin/sh', '-lc', command], Gio.SubprocessFlags.NONE); }
        catch (error) { Main.notifyError('UbuntuTool', `无法运行自定义命令：${error.message}`); }
    }

    _removeBindings() {
        for (const key of this.bindings)
            Main.wm.removeKeybinding(key);
        this.bindings = [];
        for (const id of this.grabs.keys()) {
            global.display.ungrab_accelerator(id);
            Main.wm.allowKeybinding(`external-grab-${id}`, Shell.ActionMode.NONE);
        }
        this.grabs.clear();
    }

    destroy() {
        this._removeBindings();
        global.display.disconnect(this._activationSignal);
        this.ledger.restore();
        this.settings.set_string('profile-backup', JSON.stringify(this.ledger.records));
        Gio.Settings.sync();
    }
}

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const UUID = 'ubuntutool@zhaoshi2000';
export const EXTENSION_DIR = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));
export function getSettings() {
    const source = Gio.SettingsSchemaSource.new_from_directory(`${EXTENSION_DIR}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
    const schema = source.lookup('org.gnome.shell.extensions.ubuntutool', false);
    if (!schema) throw new Error('UbuntuTool 配置未编译，请重新运行安装脚本。');
    return new Gio.Settings({settings_schema: schema});
}

export function requestTool(settings, action, extra = {}) {
    return new Promise((resolve, reject) => {
        const id = GLib.uuid_string_random();
        let signal = 0;
        let timer = 0;
        const cleanup = () => {
            if (signal) { settings.disconnect(signal); signal = 0; }
            if (timer) { GLib.source_remove(timer); timer = 0; }
        };
        signal = settings.connect('changed::tool-result', () => {
            let result;
            try { result = JSON.parse(settings.get_string('tool-result')); } catch (_) { return; }
            if (result.id !== id) return;
            cleanup();
            if (result.ok) resolve(result);
            else reject(new Error(result.error || '操作未完成。'));
        });
        // GSettings only guarantees change notifications for keys read while watched.
        settings.get_string('tool-result');
        timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3500, () => {
            timer = 0; cleanup();
            reject(new Error('工具扩展尚未启用。首次安装后请注销并重新登录，再启用 UbuntuTool。'));
            return GLib.SOURCE_REMOVE;
        });
        settings.set_string('tool-request', JSON.stringify({id, action, ...extra}));
    });
}

// Command-line recovery for a crashed or disabled Shell. No Shell imports here.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {SettingsLedger} from './core/ledger.js';

const directory = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const source = Gio.SettingsSchemaSource.new_from_directory(`${directory}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup('org.gnome.shell.extensions.ubuntutool', false);
if (!schema) throw new Error('UbuntuTool schema is unavailable; run glib-compile-schemas on the schemas directory');
const own = new Gio.Settings({settings_schema: schema});
const cache = new Map();
function settings(id) {
    if (!cache.has(id)) {
        const definition = Gio.SettingsSchemaSource.get_default().lookup(id, true);
        cache.set(id, definition ? new Gio.Settings({settings_schema: definition}) : null);
    }
    return cache.get(id);
}
const adapter = {
    has: (id, key) => settings(id)?.settings_schema.has_key(key) && settings(id).get_value(key).get_type_string() === 'as',
    get: (id, key) => settings(id).get_strv(key),
    isDefault: (id, key) => settings(id).get_user_value(key) === null,
    set: (id, key, value) => { if (!settings(id).is_writable(key) || !settings(id).set_strv(key, value)) throw new Error('Setting is not writable'); },
    reset: (id, key) => { if (!settings(id).is_writable(key)) throw new Error('Setting is not writable'); settings(id).reset(key); },
};
let records;
try { records = JSON.parse(own.get_string('profile-backup')); } catch (_) { throw new Error('Shortcut backup is corrupt; original data was preserved'); }
const ledger = new SettingsLedger(adapter, records);
const ok = ledger.restore();
own.set_string('profile-backup', JSON.stringify(ledger.records));
Gio.Settings.sync();
if (!ok) throw new Error('Some shortcuts are locked by policy; their backups were retained');
print('UbuntuTool：原快捷键已恢复；用户后续修改已保留。');

// Synthetic end-to-end RDP test; never prints the local user's clipboard data.
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
Gtk.init();
const app = new Gio.Application({application_id: 'org.example.UbuntuToolRdpTextTest', flags: Gio.ApplicationFlags.NON_UNIQUE});
app.connect('activate', () => {
    const clipboard = Gdk.Display.get_default().get_clipboard();
    const value = new GObject.Value(); value.init(GObject.TYPE_STRING);
    value.set_string('UbuntuTool RDP Unicode 文本同步 ✓ 2026-10-26');
    app.hold(); let published = false;
    clipboard.connect('changed', () => { if (published && !clipboard.is_local()) app.quit(); });
    clipboard.set_content(Gdk.ContentProvider.new_for_value(value)); published = true;
    print('SYNTHETIC_TEXT_READY');
});
await app.runAsync(['rdp-text-test']);

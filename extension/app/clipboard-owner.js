// No windows, no monitoring, no network: keep one image's native clipboard
// provider alive until another copy replaces it or the desktop session ends.
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

Gtk.init();
const app = new Gio.Application({application_id: 'io.github.zhaoshi2000.UbuntuTool.ClipboardOwner', flags: Gio.ApplicationFlags.NON_UNIQUE});
app.connect('activate', () => {
    try {
        const path = ARGV[0];
        const [format, width, height] = GdkPixbuf.Pixbuf.get_file_info(path);
        if (!format || width * height > 16 * 1024 * 1024) throw new Error('Clipboard bitmap compatibility is limited to 16 megapixels');
        const texture = Gdk.Texture.new_from_file(Gio.File.new_for_path(path));
        const pngHash = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, texture.save_to_png_bytes());
        const clipboard = Gdk.Display.get_default().get_clipboard();
        app.hold();
        let published = false, released = false;
        clipboard.connect('changed', () => {
            if (published && !clipboard.is_local() && !released) { released = true; app.release(); }
        });
        const value = new GObject.Value(); value.init(Gdk.Texture.$gtype); value.set_object(texture);
        clipboard.set_content(Gdk.ContentProvider.new_for_value(value));
        published = true;
        const formats = clipboard.get_formats().union_serialize_mime_types().get_mime_types();
        print(JSON.stringify({ok: true, formats, pngHash}));
    } catch (error) { print(JSON.stringify({ok: false, error: error.message})); app.quit(); }
});
await app.runAsync(['clipboard-owner']);

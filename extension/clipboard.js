import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

export const MAX_BITMAP_BYTES = 64 * 1024 * 1024;
const MAX_BITMAP_PIXELS = 16 * 1024 * 1024;

function decodeImage(bytes, mime) {
    const loader = GdkPixbuf.PixbufLoader.new_with_mime_type(mime);
    let tooLarge = false;
    loader.connect('size-prepared', (_loader, width, height) => {
        if (width * height > MAX_BITMAP_PIXELS || width < 1 || height < 1) {
            tooLarge = true;
            loader.set_size(1, 1);
        }
    });
    try {
        loader.write(bytes.get_data());
        loader.close();
        if (tooLarge) throw new Error('Bitmap compatibility is limited to 16 megapixels');
        const pixbuf = loader.get_pixbuf();
        if (!pixbuf) throw new Error('Image decoder returned no pixels');
        return pixbuf;
    } catch (error) {
        try { loader.close(); } catch (_) { /* already closed */ }
        throw error;
    }
}

function encodeImage(pixbuf, type) {
    const [ok, data] = pixbuf.save_to_bufferv(type, [], []);
    if (!ok) throw new Error('Image encoder failed');
    return new GLib.Bytes(data);
}

export function bitmapToPng(bytes) {
    return encodeImage(decodeImage(bytes, 'image/bmp'), 'png');
}

// GTK's native image provider serves independently encoded PNG/BMP/JPEG formats.
// Xwayland exposes that provider to both Wayland applications and RDP without
// stealing focus. A tiny, windowless process owns only the current copied image.
export async function publishCompatibleImage(extensionPath, directory, bytes, mime) {
    const suffix = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}[mime];
    if (!suffix) throw new Error('Unsupported image format');
    const file = Gio.File.new_for_path(`${directory}/clipboard-${GLib.uuid_string_random()}.${suffix}`);
    let process;
    try {
        await new Promise((resolve, reject) => file.replace_contents_async(bytes.get_data(), null, false, Gio.FileCreateFlags.PRIVATE, null, (source, result) => {
            try { source.replace_contents_finish(result); resolve(); } catch (error) { reject(error); }
        }));
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE});
        launcher.setenv('GDK_BACKEND', 'x11', true);
        process = launcher.spawnv(['gjs', '-m', `${extensionPath}/app/clipboard-owner.js`, file.get_path()]);
        const output = new Gio.DataInputStream({base_stream: process.get_stdout_pipe()});
        const cancellable = new Gio.Cancellable();
        const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4000, () => { cancellable.cancel(); return GLib.SOURCE_REMOVE; });
        let line;
        try {
            line = await new Promise((resolve, reject) => output.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
                try { resolve(source.read_line_finish_utf8(result)[0]); } catch (error) { reject(error); }
            }));
        } finally { if (!cancellable.is_cancelled()) GLib.source_remove(timeout); }
        const result = JSON.parse(line || '{}');
        if (!result.ok || !result.formats?.includes('image/bmp') || !result.formats?.includes('image/png'))
            throw new Error(result.error || 'Xwayland clipboard provider unavailable');
        return {process, pngHash: result.pngHash};
    } catch (error) {
        process?.force_exit(); throw error;
    } finally { try { file.delete(null); } catch (_) { /* temporary image already removed */ } }
}

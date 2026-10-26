// Private Wayland-session UI integration driver; never included in the extension ZIP.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

const [extensionDirectory, input, output, report] = ARGV;
const {ScreenshotEditor} = await import(GLib.filename_to_uri(`${extensionDirectory}/app/editor.js`, null));
const {getSettings, requestTool} = await import(GLib.filename_to_uri(`${extensionDirectory}/app/settings.js`, null));
const app = new Adw.Application({application_id: 'org.example.UbuntuToolEditorTest', flags: Gio.ApplicationFlags.NON_UNIQUE});
const settings = getSettings();
app.connect('startup', () => { Adw.StyleManager.get_default().color_scheme = Adw.ColorScheme.FORCE_DARK; });
app.connect('activate', () => {
    const editor = new ScreenshotEditor(app, input, {copyImage: file => requestTool(settings, 'copy-image', {path: file.get_path()})});
    editor.title = '截图标注测试 — UbuntuTool';
    editor.present();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        (async () => {
            const fit = editor.transform();
            const drag = (tool, start, end) => {
                editor.setTool(tool);
                editor.drag.emit('drag-begin', fit.x + start.x * fit.scale, fit.y + start.y * fit.scale);
                editor.drag.emit('drag-update', (end.x - start.x) * fit.scale, (end.y - start.y) * fit.scale);
                editor.drag.emit('drag-end', (end.x - start.x) * fit.scale, (end.y - start.y) * fit.scale);
            };
            drag('rectangle', {x: 30, y: 30}, {x: editor.imageWidth * 0.55, y: editor.imageHeight * 0.6});
            drag('arrow', {x: editor.imageWidth * 0.85, y: editor.imageHeight * 0.82}, {x: editor.imageWidth * 0.58, y: editor.imageHeight * 0.35});
            if (editor.document.shapes.length !== 2) throw new Error('Gesture callbacks did not create both annotations');
            editor.document.undo(); editor.document.redo(); editor._changed();
            const signature = editor.document.signature;
            const saving = editor.saveTo(Gio.File.new_for_path(output));
            editor.document.add({tool: 'rectangle', start: {x: 2, y: 2}, end: {x: 15, y: 15}, lineWidth: 2});
            if (!await saving) throw new Error('Saving annotated PNG failed');
            print('EDITOR_STAGE PNG saved');
            if (editor._checkpoint !== signature || editor.document.signature === editor._checkpoint)
                throw new Error('Edits made during export were incorrectly marked as saved');
            editor.document.undo(); editor._changed();
            if (!await editor.copy()) throw new Error('Copying the annotated image failed');
            print('EDITOR_STAGE clipboard copied');
            const image = GdkPixbuf.Pixbuf.new_from_file(output);
            const pixels = image.get_pixels(); let redPixels = 0;
            const channels = image.get_n_channels();
            const width = image.width, height = image.height, stride = image.rowstride;
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                const i = y * stride + x * channels;
                if (pixels[i] > 220 && pixels[i + 1] < 100 && pixels[i + 2] < 100) redPixels++;
            }
            if (redPixels < 100) throw new Error('Export does not contain the red annotations');
            GLib.file_set_contents(report, JSON.stringify({ok: true, width: image.width, height: image.height, redPixels, shapeCount: editor.document.shapes.length}));
        })().catch(error => { GLib.file_set_contents(report, JSON.stringify({ok: false, error: error.stack})); });
        return GLib.SOURCE_REMOVE;
    });
});
await app.runAsync(['editor-test']);

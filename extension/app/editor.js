import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Cairo from 'cairo';
import {AnnotationDocument, fitImage, imagePoint, makeAnnotation} from '../core/annotations.js';
import {drawAnnotations, exportPng} from './render.js';

function iconButton(icon, tooltip, callback) {
    const button = new Gtk.Button({icon_name: icon, tooltip_text: tooltip});
    button.connect('clicked', callback); return button;
}

export const ScreenshotEditor = GObject.registerClass(class ScreenshotEditor extends Adw.ApplicationWindow {
    _init(application, path, options = {}) {
        const [format, width, height] = GdkPixbuf.Pixbuf.get_file_info(path);
        if (!format || width < 1 || height < 1 || width * height > 64000000)
            throw new Error('图片无效或超过 6400 万像素限制。');
        super._init({application, title: '截图标注 — UbuntuTool', default_width: Math.max(740, Math.min(1160, width + 90)), default_height: Math.max(520, Math.min(820, height + 190))});
        this.source = Cairo.ImageSurface.createFromPNG(path);
        this.imageWidth = this.source.getWidth(); this.imageHeight = this.source.getHeight();
        this.document = new AnnotationDocument();
        this.tool = 'rectangle'; this.draft = null; this._dragStart = null;
        this._checkpoint = this.document.signature;
        this._copyImage = options.copyImage;
        this._temporary = options.temporary === true;
        this._sourcePath = path; this._allowClose = false; this._busy = false;
        const root = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        this.toast = new Adw.ToastOverlay({child: root});
        this.set_content(this.toast);
        const header = new Adw.HeaderBar();
        header.set_title_widget(new Adw.WindowTitle({title: '截图标注', subtitle: `${this.imageWidth} × ${this.imageHeight} · 原尺寸导出`}));
        this.undoButton = iconButton('edit-undo-symbolic', '撤销 · Ctrl+Z', () => { this.document.undo(); this._changed(); });
        this.redoButton = iconButton('edit-redo-symbolic', '重做 · Ctrl+Shift+Z', () => { this.document.redo(); this._changed(); });
        header.pack_start(this.undoButton); header.pack_start(this.redoButton);
        this.copyButton = new Gtk.Button({label: '复制图片', tooltip_text: 'Ctrl+C', css_classes: ['suggested-action']});
        this.copyButton.connect('clicked', () => this.copy());
        this.saveButton = new Gtk.Button({label: '保存', tooltip_text: '另存为 PNG · Ctrl+S'});
        this.saveButton.connect('clicked', () => this.save());
        header.pack_end(this.copyButton); header.pack_end(this.saveButton);
        root.append(header);

        const toolbar = new Gtk.Box({spacing: 10, margin_start: 18, margin_end: 18, margin_top: 10, margin_bottom: 12});
        this.rectangleButton = new Gtk.ToggleButton({label: '▭  红框  R', active: true, tooltip_text: '在图片上拖动画红色矩形框'});
        this.arrowButton = new Gtk.ToggleButton({label: '↗  箭头  A', tooltip_text: '从起点拖到需要指向的位置'});
        this.arrowButton.set_group(this.rectangleButton);
        this.rectangleButton.connect('toggled', () => { if (this.rectangleButton.active) this.setTool('rectangle'); });
        this.arrowButton.connect('toggled', () => { if (this.arrowButton.active) this.setTool('arrow'); });
        toolbar.append(this.rectangleButton); toolbar.append(this.arrowButton);
        toolbar.append(new Gtk.Separator({orientation: Gtk.Orientation.VERTICAL, margin_start: 2, margin_end: 2}));
        toolbar.append(new Gtk.Label({label: '线宽', css_classes: ['dim-label']}));
        this.lineWidth = Gtk.SpinButton.new_with_range(1, 12, 1); this.lineWidth.value = 4;
        toolbar.append(this.lineWidth);
        const spacer = new Gtk.Box({hexpand: true}); toolbar.append(spacer);
        toolbar.append(iconButton('edit-clear-all-symbolic', '清除标注（可以撤销）', () => { this.document.clear(); this._changed(); }));
        root.append(toolbar);

        this.area = new Gtk.DrawingArea({hexpand: true, vexpand: true, focusable: true, cursor: Gdk.Cursor.new_from_name('crosshair', null), css_classes: ['ut-canvas']});
        this.area.set_draw_func((_area, cr, w, h) => this._draw(cr, w, h));
        this.area.connect('resize', () => this._updateStatus());
        this.drag = new Gtk.GestureDrag({button: Gdk.BUTTON_PRIMARY});
        this.drag.connect('drag-begin', (_gesture, x, y) => this._dragBegin(x, y));
        this.drag.connect('drag-update', (_gesture, x, y) => this._dragUpdate(x, y));
        this.drag.connect('drag-end', (_gesture, x, y) => this._dragEnd(x, y));
        this.drag.connect('cancel', () => { this.draft = null; this._dragStart = null; this.area.queue_draw(); });
        this.area.add_controller(this.drag);
        root.append(this.area);
        this.status = new Gtk.Label({label: '', xalign: 0, margin_start: 20, margin_end: 20, margin_top: 12, margin_bottom: 12, css_classes: ['dim-label', 'caption']});
        root.append(this.status);
        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_controller, key, _code, modifiers) => this._key(key, modifiers));
        this.add_controller(keys);
        this.connect('close-request', () => this._closeRequested());
        this._changed();
    }

    setTool(tool) {
        this.tool = tool; this.draft = null;
        this.rectangleButton.active = tool === 'rectangle'; this.arrowButton.active = tool === 'arrow';
        this.area?.queue_draw(); this._updateStatus();
    }
    transform() { return fitImage(this.imageWidth, this.imageHeight, this.area.get_width(), this.area.get_height()); }
    _draw(cr, width, height) {
        cr.setSourceRGB(0.105, 0.11, 0.13); cr.paint();
        const fit = fitImage(this.imageWidth, this.imageHeight, width, height);
        cr.save(); cr.translate(fit.x, fit.y); cr.scale(fit.scale, fit.scale);
        cr.rectangle(0, 0, this.imageWidth, this.imageHeight); cr.clip();
        cr.setSourceSurface(this.source, 0, 0); cr.paint();
        drawAnnotations(cr, this.draft ? [...this.document.shapes, this.draft] : this.document.shapes);
        cr.restore();
    }
    _dragBegin(x, y) {
        this.area.grab_focus(); this._dragOrigin = {x, y};
        this._dragStart = imagePoint(x, y, this.transform(), this.imageWidth, this.imageHeight);
    }
    _dragUpdate(dx, dy) {
        if (!this._dragStart) return;
        const end = imagePoint(this._dragOrigin.x + dx, this._dragOrigin.y + dy, this.transform(), this.imageWidth, this.imageHeight, true);
        this.draft = makeAnnotation(this.tool, this._dragStart, end, this.lineWidth.value);
        this.area.queue_draw();
    }
    _dragEnd(dx, dy) {
        this._dragUpdate(dx, dy);
        try { if (this.draft) this.document.add(this.draft); }
        catch (error) { this.message(error.message); }
        this.draft = null; this._dragStart = null; this._changed();
    }
    _changed() {
        this.undoButton.sensitive = this.document.undoStack.length > 0;
        this.redoButton.sensitive = this.document.redoStack.length > 0;
        this.area.queue_draw(); this._updateStatus();
    }
    _updateStatus() {
        if (!this.status) return;
        const percent = Math.round(this.transform().scale * 100);
        this.status.label = `${this.tool === 'rectangle' ? '红色矩形框' : '红色箭头'} · 拖动绘制 · ${this.document.shapes.length} 个标注 · 预览 ${percent}% · 导出保持原尺寸`;
    }
    _key(key, state) {
        const control = (state & Gdk.ModifierType.CONTROL_MASK) !== 0;
        const shift = (state & Gdk.ModifierType.SHIFT_MASK) !== 0;
        const lower = Gdk.keyval_to_lower(key);
        if (control && lower === Gdk.KEY_z) { shift ? this.document.redo() : this.document.undo(); this._changed(); return true; }
        if (control && lower === Gdk.KEY_y) { this.document.redo(); this._changed(); return true; }
        if (control && lower === Gdk.KEY_s) { this.save(); return true; }
        const focus = this.get_focus();
        const editingNumber = focus === this.lineWidth || focus?.is_ancestor(this.lineWidth);
        if (control && lower === Gdk.KEY_c && !editingNumber) { this.copy(); return true; }
        if (!control && this.get_focus() === this.area && [Gdk.KEY_r, Gdk.KEY_a].includes(lower)) {
            this.setTool(lower === Gdk.KEY_r ? 'rectangle' : 'arrow'); return true;
        }
        if (key === Gdk.KEY_Escape) {
            if (this.draft) { this.draft = null; this._dragStart = null; this.area.queue_draw(); }
            else this.close();
            return true;
        }
        return false;
    }
    message(text) { this.toast.add_toast(new Adw.Toast({title: text, timeout: 4})); }
    _setBusy(value) { this._busy = value; this.copyButton.sensitive = !value; this.saveButton.sensitive = !value; }

    async copy() {
        if (this._busy) return false;
        this._setBusy(true);
        let file;
        const signature = this.document.signature;
        try {
            file = exportPng(this.source, this.document);
            if (file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size() > 20 * 1024 * 1024)
                throw new Error('图片超过 20 MB 复制上限，请使用保存。');
            if (this._copyImage) await this._copyImage(file);
            else Gdk.Display.get_default().get_clipboard().set_texture(Gdk.Texture.new_from_file(file));
            this._checkpoint = signature;
            this.message('已复制标注图片，可直接粘贴或按 Win+V 查看历史。');
            return true;
        } catch (error) { this.message(`复制失败：${error.message}`); return false; }
        finally {
            try { file?.delete(null); } catch (_) { /* Shell already consumed it */ }
            this._setBusy(false);
        }
    }

    async save() {
        if (this._busy) return false;
        const chooser = new Gtk.FileDialog({title: '保存标注图片', initial_name: `截图-${GLib.DateTime.new_now_local().format('%Y%m%d-%H%M%S')}.png`});
        const filter = new Gtk.FileFilter({name: 'PNG 图片'}); filter.add_pattern('*.png'); filter.add_pattern('*.PNG');
        const filters = new Gio.ListStore({item_type: Gtk.FileFilter}); filters.append(filter); chooser.filters = filters;
        let file;
        try {
            file = await new Promise((resolve, reject) => chooser.save(this, null, (dialog, result) => {
                try { resolve(dialog.save_finish(result)); } catch (error) { reject(error); }
            }));
        } catch (_) { return false; }
        if (!file.get_basename().toLowerCase().endsWith('.png')) file = file.get_parent().get_child(`${file.get_basename()}.png`);
        return this.saveTo(file);
    }

    async saveTo(destination) {
        if (this._busy) return false;
        this._setBusy(true);
        let output;
        const signature = this.document.signature;
        try {
            output = exportPng(this.source, this.document);
            const [, bytes] = output.load_contents(null);
            await new Promise((resolve, reject) => destination.replace_contents_async(bytes, null, false, Gio.FileCreateFlags.PRIVATE, null, (file, result) => {
                try { file.replace_contents_finish(result); resolve(); } catch (error) { reject(error); }
            }));
            this._checkpoint = signature;
            this.message(`已保存：${destination.get_basename()}`);
            return true;
        } catch (error) { this.message(`保存失败：${error.message}`); return false; }
        finally { try { output?.delete(null); } catch (_) { /* no temporary file */ } this._setBusy(false); }
    }

    _closeRequested() {
        if (this._busy) { this.message('正在处理图片，请稍候。'); return true; }
        if (!this._allowClose && this.document.signature !== this._checkpoint) {
            if (this._closeDialog) return true;
            const dialog = new Adw.MessageDialog({transient_for: this, heading: '保留这些标注？', body: '标注尚未复制或保存，关闭后无法恢复。'});
            this._closeDialog = dialog;
            dialog.add_response('cancel', '继续编辑'); dialog.add_response('discard', '放弃'); dialog.add_response('save', '保存');
            dialog.set_response_appearance('discard', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
            dialog.set_default_response('cancel'); dialog.set_close_response('cancel');
            dialog.connect('response', async (_dialog, response) => {
                this._closeDialog = null; dialog.destroy();
                if (response === 'discard' || (response === 'save' && await this.save())) {
                    this._allowClose = true; this.close();
                }
            });
            dialog.present(); return true;
        }
        if (this._temporary) {
            const folder = GLib.build_filenamev([GLib.get_user_cache_dir(), 'ubuntutool', 'captures']);
            if (GLib.path_get_dirname(this._sourcePath) === folder && /^capture-[0-9a-f-]{36}\.png$/.test(GLib.path_get_basename(this._sourcePath))) {
                try { Gio.File.new_for_path(this._sourcePath).delete(null); } catch (_) { /* already removed */ }
            }
        }
        return false;
    }
});

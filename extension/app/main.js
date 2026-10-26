import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import {ScreenshotEditor} from './editor.js';
import {getSettings, requestTool, UUID} from './settings.js';

const settings = getSettings();
const app = new Adw.Application({application_id: 'io.github.zhaoshi2000.UbuntuTool', flags: Gio.ApplicationFlags.HANDLES_COMMAND_LINE});
let hub = null;
let toast = null;

function message(text) { toast?.add_toast(new Adw.Toast({title: text, timeout: 5})); }
function shortcut(key) {
    return settings.get_strv(key).map(value => {
        const [ok, keyval, modifiers] = Gtk.accelerator_parse(value);
        return ok ? Gtk.accelerator_get_label(keyval, modifiers).replace('Super', 'Win') : value;
    }).join(' / ') || '未设置';
}

async function trigger(action) {
    if (action === 'preferences') {
        Gio.Subprocess.new(['gnome-extensions', 'prefs', UUID], Gio.SubprocessFlags.NONE); return;
    }
    hub?.set_visible(false);
    // Keep the hub out of the selected screenshot and let the compositor redraw.
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 160, () => { resolve(); return GLib.SOURCE_REMOVE; }));
    try { await requestTool(settings, action); }
    catch (error) { showHub(); message(error.message); }
}

function card(icon, title, subtitle, hint, actions) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 16, margin_start: 24, margin_end: 24, margin_top: 24, margin_bottom: 24});
    const heading = new Gtk.Box({spacing: 16});
    const image = new Gtk.Image({icon_name: icon, pixel_size: 34, css_classes: ['ut-tool-icon']}); heading.append(image);
    const titles = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4, hexpand: true});
    titles.append(new Gtk.Label({label: title, xalign: 0, css_classes: ['title-2']}));
    titles.append(new Gtk.Label({label: subtitle, xalign: 0, wrap: true, css_classes: ['dim-label']}));
    heading.append(titles); box.append(heading);
    box.append(new Gtk.Label({label: hint, xalign: 0, wrap: true, css_classes: ['caption', 'dim-label']}));
    const buttons = new Gtk.Box({spacing: 10});
    for (const [label, callback, primary] of actions) {
        const button = new Gtk.Button({label, css_classes: primary ? ['suggested-action'] : []});
        button.connect('clicked', callback); buttons.append(button);
    }
    box.append(buttons);
    const frame = new Gtk.Frame({child: box, css_classes: ['ut-tool-card']});
    return frame;
}

function showHub() {
    if (hub) { hub.present(); return; }
    hub = new Adw.ApplicationWindow({application: app, title: 'UbuntuTool 工具箱', default_width: 800, default_height: 680});
    const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    toast = new Adw.ToastOverlay({child: content}); hub.set_content(toast);
    const header = new Adw.HeaderBar(); header.set_title_widget(new Adw.WindowTitle({title: 'UbuntuTool', subtitle: '桌面实用工具'}));
    content.append(header);
    const scroll = new Gtk.ScrolledWindow({hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true}); content.append(scroll);
    const body = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 18, margin_start: 30, margin_end: 30, margin_top: 24, margin_bottom: 24});
    scroll.set_child(body);
    body.append(new Gtk.Label({label: '常用工具，随手打开', xalign: 0, css_classes: ['title-1']}));
    body.append(new Gtk.Label({label: `工具箱 ${shortcut('open-toolbox')} · 截图 ${shortcut('take-screenshot')} · 剪贴板 ${shortcut('open-clipboard')}`, xalign: 0, wrap: true, css_classes: ['dim-label']}));
    body.append(card('input-keyboard-symbolic', '快捷工具箱', 'Windows 操作习惯，留在 Ubuntu。',
        '自定义组合键、迁移常用系统快捷键，以及保存文字和图片的剪贴板历史。', [
            ['快捷键设置', () => trigger('preferences'), true], ['剪贴板历史', () => trigger('clipboard'), false],
        ]));
    body.append(card('camera-photo-symbolic', '截图标注', '框选一下，再把重点说明白。',
        '矩形区域截取 · 红色矩形框 · 箭头 · 撤销 / 重做 · 复制图片 / 保存 PNG', [
            [`开始截图  ${shortcut('take-screenshot')}`, () => trigger('screenshot'), true], ['打开 PNG 标注', () => openImage(), false],
        ]));
    body.append(new Gtk.Label({label: '本机工具 · 本机数据 · 不上传截图和剪贴板', xalign: 0, css_classes: ['caption', 'dim-label']}));
    hub.connect('close-request', () => { hub = null; toast = null; return false; });
    hub.present();
}

async function openImage() {
    const chooser = new Gtk.FileDialog({title: '打开 PNG 图片进行标注'});
    const filter = new Gtk.FileFilter({name: 'PNG 图片'}); filter.add_pattern('*.png'); filter.add_pattern('*.PNG');
    const filters = new Gio.ListStore({item_type: Gtk.FileFilter}); filters.append(filter); chooser.filters = filters;
    try {
        const file = await new Promise((resolve, reject) => chooser.open(hub, null, (dialog, result) => {
            try { resolve(dialog.open_finish(result)); } catch (error) { reject(error); }
        }));
        if (!file.get_path()) throw new Error('请先将图片下载到本机。');
        openEditor(file.get_path(), false);
    } catch (error) { if (!error.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED)) message(error.message); }
}

function openEditor(path, temporary) {
    try {
        const editor = new ScreenshotEditor(app, path, {temporary, copyImage: file => requestTool(settings, 'copy-image', {path: file.get_path()})});
        editor.present(); editor.area.grab_focus();
    } catch (error) { showHub(); message(`无法打开截图：${error.message}`); }
}

app.connect('startup', () => {
    Adw.StyleManager.get_default().color_scheme = Adw.ColorScheme.FORCE_DARK;
    const css = new Gtk.CssProvider();
    css.load_from_string('.ut-tool-card { border-radius: 18px; background: alpha(@window_fg_color,0.035); } .ut-tool-icon { color: #f5a778; }');
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
});
app.connect('activate', showHub);
app.connect('command-line', (_app, commandLine) => {
    const args = commandLine.get_arguments().slice(1);
    if (args[0] === '--edit' && args[1]) openEditor(args[1], args.includes('--temporary'));
    else if (args[0] === '--screenshot') {
        app.hold();
        trigger('screenshot').finally(() => app.release());
    }
    else showHub();
    return 0;
});
await app.runAsync(['ubuntutool', ...ARGV]);

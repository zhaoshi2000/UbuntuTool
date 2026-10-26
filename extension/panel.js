import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

function button(icon, title, callback, style = 'ut-icon-button') {
    const actor = new St.Button({
        style_class: style, can_focus: true, accessible_name: title,
        child: new St.Icon({icon_name: icon, icon_size: 16}),
    });
    actor.connect('clicked', callback);
    return actor;
}

function relativeTime(timestamp) {
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
    return `${Math.floor(minutes / 1440)} 天前`;
}

export class ClipboardPanel {
    constructor(extension, model, storage, settings, select) {
        this.extension = extension;
        this.model = model;
        this.storage = storage;
        this.settings = settings;
        this.select = select;
        this.filter = 'all';
        this.visibleLimit = 50;
        this._rows = [];
        this._activeIndex = 0;
        this._signals = [];
        this._dialog = null;

        this.indicator = new PanelMenu.Button(0.0, 'UbuntuTool 剪贴板', false);
        this.indicator.add_child(new St.Icon({icon_name: 'edit-paste-symbolic', style_class: 'system-status-icon'}));
        Main.panel.addToStatusArea(extension.uuid, this.indicator);
        this.indicator.menu.actor.add_style_class_name('ut-popup');
        const section = new PopupMenu.PopupMenuSection();
        this.indicator.menu.addMenuItem(section);
        const root = new St.BoxLayout({vertical: true, style_class: 'ut-root'});
        section.box.add_child(root);

        const header = new St.BoxLayout({style_class: 'ut-header'});
        header.add_child(new St.Icon({icon_name: 'edit-paste-symbolic', style_class: 'ut-brand-icon', icon_size: 26}));
        const titles = new St.BoxLayout({vertical: true, x_expand: true});
        titles.add_child(new St.Label({text: '剪贴板', style_class: 'ut-title'}));
        this.subtitle = new St.Label({text: 'Win + V · 本机历史', style_class: 'ut-subtitle'});
        titles.add_child(this.subtitle);
        header.add_child(titles);
        header.add_child(button('emblem-system-symbolic', 'UbuntuTool 设置', () => {
            this.indicator.menu.close();
            extension.openPreferences();
        }));
        root.add_child(header);

        this.search = new St.Entry({
            hint_text: '搜索历史内容…', can_focus: true, style_class: 'ut-search',
            primary_icon: new St.Icon({icon_name: 'edit-find-symbolic', icon_size: 16}),
        });
        this.search.clutter_text.connect('text-changed', () => {
            this.visibleLimit = 50;
            this.render();
        });
        this.search.clutter_text.connect('key-press-event', (_actor, event) => this._keyPress(event));
        root.add_child(this.search);

        const tabs = new St.BoxLayout({style_class: 'ut-tabs'});
        this._tabs = new Map();
        for (const [key, title] of [['all', '全部'], ['text', '文本'], ['image', '图片'], ['pinned', '已固定']]) {
            const tab = new St.Button({label: title, style_class: 'ut-tab', can_focus: true, x_expand: true});
            tab.connect('clicked', () => { this.filter = key; this.visibleLimit = 50; this.render(); });
            tabs.add_child(tab);
            this._tabs.set(key, tab);
        }
        root.add_child(tabs);

        this.scroll = new St.ScrollView({style_class: 'ut-scroll', overlay_scrollbars: true, x_expand: true});
        this.scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this.list = new St.BoxLayout({vertical: true, style_class: 'ut-list'});
        this.scroll.set_child(this.list);
        root.add_child(this.scroll);

        const footer = new St.BoxLayout({style_class: 'ut-footer'});
        const toolbox = new St.Button({label: '工具箱', style_class: 'ut-footer-button', can_focus: true});
        toolbox.connect('clicked', () => { this.close(); extension._activate('toolbox'); });
        footer.add_child(toolbox);
        this.pause = new St.Button({label: '暂停记录', style_class: 'ut-footer-button', can_focus: true, x_expand: true});
        this.pause.connect('clicked', () => settings.set_boolean('paused', !settings.get_boolean('paused')));
        footer.add_child(this.pause);
        const clear = new St.Button({label: '清空未固定', style_class: 'ut-footer-button', can_focus: true});
        clear.connect('clicked', () => this._confirmClear());
        footer.add_child(clear);
        root.add_child(footer);
        this.hint = new St.Label({text: '↑↓ 选择  ·  Enter 粘贴  ·  Esc 关闭', style_class: 'ut-hint'});
        root.add_child(this.hint);

        this._signals.push(settings.connect('changed::paused', () => this.render()));
        this.indicator.menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                return;
            this.visibleLimit = 50;
            this.model.prune();
            this.extension.historyChanged();
            this.search.set_text('');
            this._activeIndex = 0;
            this.render();
            this.search.grab_key_focus();
        });
    }

    toggle() { this.indicator.menu.toggle(); }
    close() { this.indicator.menu.close(); }

    render() {
        const paused = this.settings.get_boolean('paused');
        this.pause.label = paused ? '继续记录' : '暂停记录';
        this.subtitle.text = paused ? '已暂停 · 历史仍可使用' : `${this.model.entries.length} 条记录 · 仅保存在本机`;
        for (const [key, tab] of this._tabs) {
            if (key === this.filter) tab.add_style_pseudo_class('active');
            else tab.remove_style_pseudo_class('active');
        }
        this.list.destroy_all_children();
        this._rows = [];
        const results = this.model.query(this.search.get_text(), this.filter);
        if (!results.length) {
            const empty = new St.BoxLayout({vertical: true, style_class: 'ut-empty'});
            empty.add_child(new St.Icon({icon_name: 'edit-paste-symbolic', icon_size: 42, style_class: 'ut-empty-icon'}));
            empty.add_child(new St.Label({text: this.search.get_text() ? '没有找到匹配内容' : '复制一点灵感，留在这里', style_class: 'ut-empty-title'}));
            empty.add_child(new St.Label({text: '复制文字或图片后，按 Win + V 查看。', style_class: 'ut-subtitle'}));
            this.list.add_child(empty);
        }
        for (const entry of results.slice(0, this.visibleLimit))
            this._addRow(entry);
        if (results.length > this.visibleLimit) {
            const more = new St.Button({label: `加载更多（还有 ${results.length - this.visibleLimit} 条）`, style_class: 'ut-footer-button', can_focus: true});
            more.connect('clicked', () => { this.visibleLimit += 50; this.render(); });
            this.list.add_child(more);
        }
        this._activeIndex = Math.min(this._activeIndex, Math.max(0, this._rows.length - 1));
        this._highlight();
        this.hint.text = this.settings.get_boolean('auto-paste') ?
            '↑↓ 选择  ·  Enter 粘贴  ·  Esc 关闭' : '↑↓ 选择  ·  Enter 复制  ·  Ctrl + V 粘贴';
    }

    _addRow(entry) {
        const row = new St.BoxLayout({style_class: 'ut-card'});
        const content = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'ut-card-content'});
        const meta = new St.BoxLayout({style_class: 'ut-card-meta'});
        const size = entry.byteSize < 1024 ? `${entry.byteSize} B` : `${(entry.byteSize / 1024).toFixed(0)} KB`;
        const label = entry.kind === 'text' ? '文本' : `图片 · ${size}`;
        meta.add_child(new St.Label({text: `${entry.pinned ? '已固定 · ' : ''}${label}`, x_expand: true, style_class: 'ut-kind'}));
        meta.add_child(new St.Label({text: relativeTime(entry.updatedAt), style_class: 'ut-time'}));
        content.add_child(meta);
        if (entry.kind === 'image') {
            content.add_child(new St.Icon({
                gicon: new Gio.FileIcon({file: this.storage.imageFile(entry.imageName)}),
                icon_size: 92, style_class: 'ut-thumbnail', x_align: Clutter.ActorAlign.START,
            }));
        } else {
            const text = new St.Label({text: entry.text.slice(0, 420), style_class: 'ut-preview', x_expand: true});
            text.clutter_text.line_wrap = true;
            text.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            text.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            content.add_child(text);
        }
        const choose = new St.Button({child: content, can_focus: true, x_expand: true, style_class: 'ut-choose', accessible_name: entry.kind === 'image' ? '粘贴图片' : '粘贴文本'});
        choose.connect('clicked', () => this.select(entry));
        row.add_child(choose);
        const actions = new St.BoxLayout({vertical: true, style_class: 'ut-card-actions'});
        actions.add_child(button(entry.pinned ? 'view-pin-symbolic' : 'list-add-symbolic', entry.pinned ? '取消固定' : '固定记录', () => {
            try { this.model.togglePin(entry.id); this.extension.historyChanged(); }
            catch (error) { Main.notify('UbuntuTool', error.message); }
        }));
        actions.add_child(button('edit-delete-symbolic', '删除记录', () => {
            this.model.remove(entry.id);
            this.extension.historyChanged();
        }));
        row.add_child(actions);
        this.list.add_child(row);
        this._rows.push({row, entry, choose});
    }

    _keyPress(event) {
        const key = event.get_key_symbol();
        if ([Clutter.KEY_Down, Clutter.KEY_Up].includes(key)) {
            if (this._rows.length) {
                this._activeIndex = (this._activeIndex + (key === Clutter.KEY_Down ? 1 : -1) + this._rows.length) % this._rows.length;
                this._highlight();
                const row = this._rows[this._activeIndex].row;
                const adjustment = this.scroll.vscroll.adjustment;
                const y = row.get_y();
                if (y < adjustment.value) adjustment.value = y;
                else if (y + row.height > adjustment.value + adjustment.page_size)
                    adjustment.value = y + row.height - adjustment.page_size;
            }
            return Clutter.EVENT_STOP;
        }
        if ([Clutter.KEY_Return, Clutter.KEY_KP_Enter].includes(key) && this._rows.length) {
            this.select(this._rows[this._activeIndex].entry);
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _highlight() {
        this._rows.forEach(({row}, index) => {
            if (index === this._activeIndex) row.add_style_pseudo_class('selected');
            else row.remove_style_pseudo_class('selected');
        });
    }

    _confirmClear() {
        this.close();
        this._dialog = new ModalDialog.ModalDialog();
        this._dialog.contentLayout.add_child(new St.Label({text: '清空未固定的剪贴板记录？', style_class: 'ut-dialog-title'}));
        this._dialog.contentLayout.add_child(new St.Label({text: '已固定的记录会保留。此操作无法撤销。'}));
        this._dialog.setButtons([
            {label: '取消', key: Clutter.KEY_Escape, action: () => this._closeDialog()},
            {label: '清空', default: true, action: () => {
                this.model.clear(true);
                this.extension.historyChanged();
                this._closeDialog();
            }},
        ]);
        this._dialog.open();
    }

    _closeDialog() { this._dialog?.close(); this._dialog?.destroy(); this._dialog = null; }
    destroy() {
        for (const id of this._signals) this.settings.disconnect(id);
        this._closeDialog();
        this.indicator.destroy();
    }
}

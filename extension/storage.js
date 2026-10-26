import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const encoder = new TextEncoder();
const IMAGE_NAME = /^[a-f0-9]{64}\.(png|jpg|webp)$/;

function writePrivate(file, data) {
    return new Promise((resolve, reject) => {
        file.replace_contents_async(data, null, false, Gio.FileCreateFlags.PRIVATE, null, (source, result) => {
            try {
                source.replace_contents_finish(result);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

export class HistoryStorage {
    constructor() {
        this.directory = GLib.build_filenamev([GLib.get_user_data_dir(), 'ubuntutool']);
        this.imagesDirectory = GLib.build_filenamev([this.directory, 'images']);
        GLib.mkdir_with_parents(this.imagesDirectory, 0o700);
        GLib.chmod(this.directory, 0o700);
        GLib.chmod(this.imagesDirectory, 0o700);
        this.file = Gio.File.new_for_path(`${this.directory}/history.json`);
        this._pendingImages = new Set();
        this._queued = null;
        this._saving = false;
        this._timer = 0;
        this._liveImages = new Set();
    }

    load() {
        if (!this.file.query_exists(null))
            return [];
        try {
            const info = this.file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
            if (info.get_size() > 140 * 1024 * 1024)
                throw new Error('History index exceeds storage budget');
            const [, contents] = this.file.load_contents(null);
            const data = JSON.parse(new TextDecoder().decode(contents));
            if (data.version !== 1 || !Array.isArray(data.entries))
                throw new Error('Unknown history format');
            return data.entries.filter(item => item.kind !== 'image' ||
                (IMAGE_NAME.test(item.imageName ?? '') && this.imageFile(item.imageName).query_exists(null)));
        } catch (error) {
            console.warn(`[UbuntuTool] Could not read local history: ${error.message}`);
            // Leave the corrupt file available for recovery, without putting data in logs.
            try { this.file.move(Gio.File.new_for_path(`${this.directory}/history.corrupt-${Date.now()}.json`), Gio.FileCopyFlags.NONE, null, null); } catch (_) { /* keep original */ }
            return [];
        }
    }

    imageFile(name) {
        if (!IMAGE_NAME.test(name))
            throw new Error('Invalid image filename');
        return Gio.File.new_for_path(`${this.imagesDirectory}/${name}`);
    }

    async writeImage(name, bytes) {
        const file = this.imageFile(name);
        if (file.query_exists(null))
            return;
        this._pendingImages.add(name);
        try {
            await writePrivate(file, bytes.get_data());
        } finally {
            this._pendingImages.delete(name);
        }
    }

    readImage(name) {
        const file = this.imageFile(name);
        const info = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
        if (info.get_size() > 20 * 1024 * 1024)
            throw new Error('Image exceeds size limit');
        const [, data] = file.load_contents(null);
        return new GLib.Bytes(data);
    }

    schedule(entries, persistent) {
        // Snapshot: model changes while an async write is pending must not mutate it.
        this._queued = {entries: entries.map(item => ({...item})), persistent};
        this._liveImages = new Set(entries.filter(item => item.kind === 'image').map(item => item.imageName));
        if (!this._timer) {
            this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                this._timer = 0;
                this._drain();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    async _drain() {
        if (this._saving)
            return;
        this._saving = true;
        try {
            while (this._queued) {
                const {entries, persistent} = this._queued;
                this._queued = null;
                const saved = persistent ? entries : [];
                await writePrivate(this.file, encoder.encode(JSON.stringify({version: 1, entries: saved})));
                // In-memory image history still needs its local image payloads, even when
                // the index is not persisted. They are discarded on shutdown in that mode.
                // Use the latest model, not the older snapshot that just finished writing.
                // Otherwise a later copy could lose its image while a save was in flight.
                this._collectImages(this._liveImages);
            }
        } catch (error) {
            console.error(`[UbuntuTool] History could not be saved: ${error.message}`);
        } finally {
            this._saving = false;
        }
    }

    _collectImages(keep) {
        const dir = Gio.File.new_for_path(this.imagesDirectory);
        const enumerator = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        try {
            let info;
            while ((info = enumerator.next_file(null))) {
                const name = info.get_name();
                if (IMAGE_NAME.test(name) && !keep.has(name) && !this._pendingImages.has(name)) {
                    try { dir.get_child(name).delete(null); } catch (_) { /* retry next save */ }
                }
            }
        } finally {
            enumerator.close(null);
        }
    }

    close(entries, persistent) {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        this._queued = {entries: persistent ? entries.map(item => ({...item})) : [], persistent};
        this._liveImages = new Set(persistent ? entries.filter(item => item.kind === 'image').map(item => item.imageName) : []);
        this._drain();
    }
}

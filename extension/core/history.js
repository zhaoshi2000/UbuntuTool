// Platform-independent model; also exercised by Node's built-in test runner.
export const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_STORAGE_BYTES = 128 * 1024 * 1024;
export const MAX_PINNED = 50;
const DAY = 86400000;
const IMAGE_NAME = /^[a-f0-9]{64}\.(png|jpg|webp)$/;

export function validEntry(value) {
    if (!value || !/^[a-f0-9]{64}$/.test(value.id ?? '') ||
        !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) ||
        !Number.isInteger(value.byteSize) || value.byteSize <= 0)
        return null;
    const base = {
        id: value.id, kind: value.kind, createdAt: value.createdAt,
        updatedAt: value.updatedAt, byteSize: value.byteSize, pinned: value.pinned === true,
    };
    if (value.kind === 'text' && typeof value.text === 'string' &&
        value.text.length > 0 && value.text.length <= MAX_TEXT_BYTES &&
        new TextEncoder().encode(value.text).length === value.byteSize && value.byteSize <= MAX_TEXT_BYTES)
        return {...base, text: value.text, mime: 'text/plain', storageSize: new TextEncoder().encode(JSON.stringify(value.text)).length + 256};
    if (value.kind === 'image' && IMAGE_NAME.test(value.imageName ?? '') &&
        value.imageName.startsWith(`${value.id}.`) && value.byteSize <= MAX_IMAGE_BYTES &&
        ['image/png', 'image/jpeg', 'image/webp'].includes(value.mime)) {
        const extension = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}[value.mime];
        if (value.imageName !== `${value.id}.${extension}`)
            return null;
        return {...base, imageName: value.imageName, mime: value.mime};
    }
    return null;
}

export class HistoryModel {
    constructor({limit = 100, retentionDays = 30, now = () => Date.now()} = {}) {
        this.limit = limit;
        this.retentionDays = retentionDays;
        this.now = now;
        this.entries = [];
    }

    load(values) {
        const seen = new Set();
        this.entries = (Array.isArray(values) ? values : []).map(validEntry)
            .filter(entry => entry && !seen.has(entry.id) && seen.add(entry.id));
        // A corrupt file cannot bypass the pin budget or leave unlimited immortal records.
        let pins = 0;
        for (const entry of this.entries) {
            if (entry.pinned && ++pins > MAX_PINNED)
                entry.pinned = false;
        }
        this.prune();
    }

    add(value) {
        const entry = validEntry(value);
        if (!entry)
            throw new Error('Invalid clipboard entry');
        const existing = this.entries.find(item => item.id === entry.id);
        if (existing) {
            existing.updatedAt = this.now();
        } else {
            this.entries.unshift(entry);
        }
        this.prune();
        return existing ?? entry;
    }

    prune() {
        const cutoff = this.now() - Math.max(1, this.retentionDays) * DAY;
        this.entries = this.entries.filter(item => item.pinned || item.updatedAt >= cutoff);
        this.entries.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
        const cost = item => item.kind === 'text' ? item.storageSize : item.byteSize;
        let bytes = this.entries.reduce((sum, item) => sum + cost(item), 0);
        const limit = Math.max(1, Math.min(500, this.limit));
        for (let i = this.entries.length - 1; i >= 0 &&
            (this.entries.length > limit || bytes > MAX_STORAGE_BYTES); i--) {
            if (this.entries[i].pinned)
                continue;
            bytes -= cost(this.entries[i]);
            this.entries.splice(i, 1);
        }
        // Corrupt/imported data cannot bypass the disk budget using only pinned records.
        while (bytes > MAX_STORAGE_BYTES && this.entries.length)
            bytes -= cost(this.entries.pop());
    }

    togglePin(id) {
        const entry = this.entries.find(item => item.id === id);
        if (!entry)
            return false;
        if (!entry.pinned && this.entries.filter(item => item.pinned).length >= MAX_PINNED)
            throw new Error(`最多固定 ${MAX_PINNED} 条记录`);
        entry.pinned = !entry.pinned;
        this.prune();
        return entry.pinned;
    }

    remove(id) {
        this.entries = this.entries.filter(item => item.id !== id);
    }

    clear(keepPinned = true) {
        this.entries = keepPinned ? this.entries.filter(item => item.pinned) : [];
    }

    query(search = '', filter = 'all') {
        const needle = search.normalize('NFKC').toLocaleLowerCase().trim();
        return this.entries.filter(item => {
            if (filter === 'pinned' && !item.pinned)
                return false;
            if (['text', 'image'].includes(filter) && item.kind !== filter)
                return false;
            const haystack = item.kind === 'text' ? item.text : `图片 image ${item.mime}`;
            return !needle || haystack.normalize('NFKC').toLocaleLowerCase().includes(needle);
        });
    }
}

export function chooseMime(mimes) {
    if (mimes.some(mime => /passwordmanagerhint|keepass|1password|bitwarden|application\/x-secret/i.test(mime)))
        return null;
    return ['image/png', 'image/jpeg', 'image/webp', 'image/bmp',
        'text/plain;charset=utf-8', 'text/plain;charset=UTF-8', 'text/plain', 'UTF8_STRING']
        .find(mime => mimes.includes(mime)) ?? null;
}

export function normalizeAccelerator(value) {
    const aliases = {primary: 'ctrl', control: 'ctrl', mod1: 'alt', mod4: 'super'};
    const modifiers = [...value.toLowerCase().matchAll(/<([^>]+)>/g)]
        .map(match => aliases[match[1]] ?? match[1]).sort();
    return `${modifiers.join('+')}+${value.replace(/<[^>]+>/g, '').toLowerCase()}`;
}

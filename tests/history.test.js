import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {HistoryModel, validEntry, chooseMime, normalizeAccelerator, MAX_IMAGE_BYTES} from '../extension/core/history.js';

const NOW = 1800000000000;
function text(value, extra = {}) {
    return {id: createHash('sha256').update(value).digest('hex'), kind: 'text', text: value,
        byteSize: Buffer.byteLength(value), createdAt: NOW, updatedAt: NOW, pinned: false, ...extra};
}

test('deduplicates re-copies, promotes recency and preserves pin state', () => {
    let now = NOW;
    const model = new HistoryModel({now: () => now});
    model.add(text('hello')); model.togglePin(text('hello').id);
    now += 100; model.add(text('other', {updatedAt: now}));
    now += 100; model.add(text('hello'));
    assert.equal(model.entries.length, 2);
    assert.equal(model.entries[0].pinned, true);
    assert.equal(model.entries[0].updatedAt, now);
});

test('expires old records and bounds count while preserving pinned entries', () => {
    const model = new HistoryModel({limit: 2, retentionDays: 1, now: () => NOW});
    model.load([text('old', {updatedAt: 0}), text('pin', {updatedAt: 0, pinned: true}), text('a'), text('b', {updatedAt: NOW + 1})]);
    assert.deepEqual(model.entries.map(item => item.text), ['pin', 'b']);
    model.clear(); assert.equal(model.entries.length, 1);
    model.clear(false); assert.equal(model.entries.length, 0);
});

test('rejects malformed records and path traversal from disk', () => {
    const id = 'a'.repeat(64);
    const image = {id, kind: 'image', mime: 'image/png', imageName: `${id}.png`, byteSize: 200, createdAt: NOW, updatedAt: NOW};
    assert.ok(validEntry(image));
    assert.equal(validEntry({...image, imageName: '../../private-file'}), null);
    assert.equal(validEntry({...image, imageName: `${'b'.repeat(64)}.png`}), null);
    assert.equal(validEntry({...image, mime: 'image/webp'}), null);
    assert.equal(validEntry({...image, byteSize: MAX_IMAGE_BYTES + 1}), null);
    assert.equal(validEntry(text('你好', {byteSize: 2})), null);
    const model = new HistoryModel({now: () => NOW});
    model.load([null, image, image, {id: '__proto__'}]);
    assert.equal(model.entries.length, 1);
});

test('text search normalizes Unicode and filters pictures / pinned content', () => {
    const model = new HistoryModel({now: () => NOW});
    model.add(text('ＨＥＬＬＯ 世界'));
    assert.equal(model.query('hello').length, 1);
    assert.equal(model.query('世界').length, 1);
    assert.equal(model.query('', 'image').length, 0);
    model.togglePin(model.entries[0].id);
    assert.equal(model.query('', 'pinned').length, 1);
});

test('sensitive MIME hints are ignored and images take precedence over text fallbacks', () => {
    assert.equal(chooseMime(['text/plain', 'x-kde-passwordManagerHint']), null);
    assert.equal(chooseMime(['image/png', 'text/plain']), 'image/png');
    assert.equal(chooseMime(['text/html']), null);
    assert.equal(chooseMime(['text/plain;charset=utf-8']), 'text/plain;charset=utf-8');
});

test('accelerator aliases and modifier order resolve to a common identity', () => {
    assert.equal(normalizeAccelerator('<Primary><Shift>v'), normalizeAccelerator('<shift><Control>V'));
    assert.equal(normalizeAccelerator('<Mod4>v'), normalizeAccelerator('<Super>v'));
});

test('storage budget also constrains image-heavy history', () => {
    const model = new HistoryModel({limit: 100, now: () => NOW});
    for (let i = 0; i < 10; i++) {
        const id = createHash('sha256').update(`image-${i}`).digest('hex');
        model.add({id, kind: 'image', mime: 'image/png', imageName: `${id}.png`, byteSize: MAX_IMAGE_BYTES, createdAt: NOW, updatedAt: NOW + i, pinned: false});
    }
    assert.equal(model.entries.length, 6);
});

test('a corrupt all-pinned import cannot escape the total storage budget', () => {
    const model = new HistoryModel({limit: 100, now: () => NOW});
    model.load(Array.from({length: 12}, (_, i) => {
        const id = createHash('sha256').update(`pinned-image-${i}`).digest('hex');
        return {id, kind: 'image', mime: 'image/png', imageName: `${id}.png`, byteSize: MAX_IMAGE_BYTES, createdAt: NOW, updatedAt: NOW + i, pinned: true};
    }));
    assert.equal(model.entries.length, 6);
});

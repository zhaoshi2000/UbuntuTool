import test from 'node:test';
import assert from 'node:assert/strict';
import {SettingsLedger} from '../extension/core/ledger.js';

function setup() {
    const defaults = new Map([['shell/tray', ['<Super>v', '<Super>m']], ['wm/close', ['<Alt>F4']]]);
    const user = new Map();
    const id = (schema, key) => `${schema}/${key}`;
    const adapter = {
        has: (schema, key) => defaults.has(id(schema, key)),
        get: (schema, key) => [...(user.get(id(schema, key)) ?? defaults.get(id(schema, key)))],
        set: (schema, key, value) => user.set(id(schema, key), [...value]),
        reset: (schema, key) => user.delete(id(schema, key)),
        isDefault: (schema, key) => !user.has(id(schema, key)),
    };
    return {adapter, user};
}

test('borrowing Super+V preserves other keys and restores the actual default', () => {
    const {adapter, user} = setup(); const ledger = new SettingsLedger(adapter);
    ledger.set('shell', 'tray', ['<Super>m']);
    assert.deepEqual(adapter.get('shell', 'tray'), ['<Super>m']);
    ledger.restore();
    assert.deepEqual(adapter.get('shell', 'tray'), ['<Super>v', '<Super>m']);
    assert.equal(user.has('shell/tray'), false);
});

test('manual user changes made after activation survive restore', () => {
    const {adapter} = setup(); const ledger = new SettingsLedger(adapter);
    ledger.set('shell', 'tray', ['<Super>m']);
    adapter.set('shell', 'tray', ['<Super>n']);
    ledger.restore();
    assert.deepEqual(adapter.get('shell', 'tray'), ['<Super>n']);
});

test('a serialized backup can recover from a crashed extension', () => {
    const {adapter} = setup();
    adapter.set('wm', 'close', ['<Super>q']);
    const first = new SettingsLedger(adapter); first.set('wm', 'close', ['<Alt>F4']);
    const second = new SettingsLedger(adapter, JSON.parse(JSON.stringify(first.records)));
    assert.equal(second.restore(), true);
    assert.deepEqual(adapter.get('wm', 'close'), ['<Super>q']);
});

test('unavailable desktop keys are skipped without inventing settings', () => {
    const {adapter} = setup(); const ledger = new SettingsLedger(adapter);
    assert.equal(ledger.set('missing', 'key', ['a']), false);
    assert.equal(ledger.records.length, 0);
});

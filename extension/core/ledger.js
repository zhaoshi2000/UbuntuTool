// Restore settings only when they still match the value UbuntuTool applied.
// Later user edits are never overwritten on disable/uninstall.
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class SettingsLedger {
    constructor(adapter, records = []) {
        this.adapter = adapter;
        this.records = Array.isArray(records) ? records.filter(record =>
            record && typeof record.schema === 'string' && typeof record.key === 'string' &&
            Array.isArray(record.before) && Array.isArray(record.applied) &&
            [...record.before, ...record.applied].every(value => typeof value === 'string')) : [];
    }

    set(schema, key, value) {
        if (!this.adapter.has(schema, key))
            return false;
        const current = this.adapter.get(schema, key);
        if (equal(current, value))
            return true;
        let record = this.records.find(item => item.schema === schema && item.key === key);
        if (record && !equal(current, record.applied)) {
            this.records = this.records.filter(item => item !== record);
            record = null;
        }
        if (!record) {
            record = {schema, key, before: current, wasDefault: this.adapter.isDefault(schema, key), applied: value};
            this.records.push(record);
        }
        this.adapter.set(schema, key, value);
        record.applied = [...value];
        return true;
    }

    restore() {
        const failed = [];
        for (const record of [...this.records].reverse()) {
            try {
                if (!this.adapter.has(record.schema, record.key))
                    continue;
                if (!equal(this.adapter.get(record.schema, record.key), record.applied))
                    continue;
                if (record.wasDefault)
                    this.adapter.reset(record.schema, record.key);
                else
                    this.adapter.set(record.schema, record.key, record.before);
            } catch (error) {
                failed.unshift(record);
            }
        }
        this.records = failed;
        return failed.length === 0;
    }
}

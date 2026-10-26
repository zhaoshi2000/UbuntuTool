import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

function files(directory) {
    return readdirSync(directory, {withFileTypes: true}).flatMap(entry =>
        entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}
let failed = false;
for (const file of [...files('extension'), ...files('tests')].filter(path => path.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
    if (result.status !== 0) { process.stderr.write(result.stderr); failed = true; }
}
const metadata = JSON.parse(readFileSync('extension/metadata.json', 'utf8'));
if (metadata.uuid !== 'ubuntutool@zhaoshi2000' || !metadata['shell-version'].includes('50')) failed = true;
if (failed) process.exit(1);
console.log('JavaScript syntax and extension metadata OK');

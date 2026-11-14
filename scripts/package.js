import { mkdir, readdir, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
await mkdir('dist', { recursive: true });
const { version } = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
const archive = resolve(`dist/switch-tab-${version}.zip`);
await rm(archive, { force: true });
execFileSync('zip', ['-q', archive, ...await readdir('extension')], { cwd: 'extension' });
console.log(archive);

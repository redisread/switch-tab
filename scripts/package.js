import { mkdir, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
await mkdir('dist', { recursive: true });
const archive = resolve('dist/switch-tab-0.1.0.zip');
await rm(archive, { force: true });
execFileSync('zip', ['-q', archive, ...await readdir('extension')], { cwd: 'extension' });
console.log(archive);

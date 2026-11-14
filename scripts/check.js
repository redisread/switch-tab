import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
if (manifest.manifest_version !== 3 || manifest.incognito !== 'not_allowed') throw new Error('Invalid manifest');
for (const file of await readdir('extension')) {
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', `extension/${file}`]);
}
for (const file of [manifest.background.service_worker, manifest.action.default_popup,
  ...manifest.content_scripts.flatMap(script => script.js)]) await readFile(`extension/${file}`);
console.log('Manifest resources and JavaScript syntax verified.');

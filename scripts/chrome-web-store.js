import { readFile, readdir, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const operation = process.argv[2];
if (!['status', 'publish'].includes(operation)) throw Error('Expected status or publish');
const { CWS_PUBLISHER_ID: publisher, CWS_ITEM_ID: item, CWS_ACCESS_TOKEN: token } = process.env;
if (!publisher || !item || !token) throw Error('Missing Chrome Web Store configuration');
const resource = `publishers/${encodeURIComponent(publisher)}/items/${encodeURIComponent(item)}`;
const base = 'https://chromewebstore.googleapis.com';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
    signal: AbortSignal.timeout(60_000),
  });
  // Do not log API bodies or credentials on failures. Query status before retrying mutations.
  if (!response.ok) throw Error(`Chrome Web Store HTTP ${response.status}; inspect dashboard before retrying`);
  return response.json();
}
const status = () => request(`/v2/${resource}:fetchStatus`);
const versions = revision => revision?.distributionChannels?.map(channel => channel.crxVersion) ?? [];
async function report(data) {
  const summary = JSON.stringify({
    published: data.publishedItemRevisionStatus,
    submitted: data.submittedItemRevisionStatus,
    upload: data.lastAsyncUploadState,
  }, null, 2);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Chrome Web Store status\n\n\`\`\`json\n${summary}\n\`\`\`\n`);
  }
}

const before = await status();
await report(before);
if (operation === 'publish') {
  const { version } = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
  if (before.lastAsyncUploadState === 'IN_PROGRESS') throw Error('An upload is still processing; query status before retrying');
  if (versions(before.publishedItemRevisionStatus).includes(version)) {
    console.log(`Version ${version} is already published.`);
  } else if (before.submittedItemRevisionStatus &&
      !['CANCELLED', 'REJECTED'].includes(before.submittedItemRevisionStatus.state)) {
    throw Error('A submission already exists. Inspect its status before uploading a new version.');
  } else {
    async function findArchive(directory) {
      const files = [];
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) files.push(...await findArchive(path));
        else if (entry.name === `switch-tab-${version}.zip`) files.push(path);
      }
      return files;
    }
    const archives = await findArchive('release-artifact');
    if (archives.length !== 1) throw Error('Expected exactly one tested release archive');
    const manifest = JSON.parse(execFileSync('unzip', ['-p', archives[0], 'manifest.json'], { encoding: 'utf8' }));
    if (manifest.version !== version) throw Error('Archive version differs from checked-out source');
    const uploaded = await request(`/upload/v2/${resource}:upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/zip' },
      body: await readFile(archives[0]),
    });
    let uploadState = uploaded.uploadState;
    for (let attempt = 0; uploadState === 'IN_PROGRESS' && attempt < 24; attempt++) {
      await sleep(10_000);
      uploadState = (await status()).lastAsyncUploadState;
    }
    if (uploadState !== 'SUCCEEDED') throw Error(`Upload did not complete: ${uploadState}`);
    if (uploaded.crxVersion && uploaded.crxVersion !== version) throw Error('Server reported a different uploaded version');
    const result = await request(`/v2/${resource}:publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true }),
    });
    console.log(`Submission response: ${result.state}`);
    await report(await status());
    if (!['PENDING_REVIEW', 'PUBLISHED'].includes(result.state)) throw Error('Unexpected submission state; inspect dashboard');
  }
}

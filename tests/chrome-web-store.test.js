import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function run(operation, response) {
  const preload = `globalThis.fetch = async (url, options) => {
    if (options.method === 'POST') throw Error('Unexpected mutation');
    return {ok:true,json:async()=>(${JSON.stringify(response)})};
  };`;
  return spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, 'scripts/chrome-web-store.js', operation], {
    encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '', CWS_PUBLISHER_ID: 'test', CWS_ITEM_ID: 'test', CWS_ACCESS_TOKEN: 'secret-test-token' },
  });
}
test('status is read-only and reports the actual submitted state', () => {
  const result = run('status', { submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PENDING_REVIEW/);
  assert.doesNotMatch(result.stdout + result.stderr, /secret-test-token/);
});
test('existing pending submission prevents upload', () => {
  const result = run('publish', { submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /A submission already exists/);
  assert.doesNotMatch(result.stderr, /Unexpected mutation/);
});
test('already published target version is an idempotent no-op', () => {
  const result = run('publish', { publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{crxVersion:JSON.parse(readFileSync('extension/manifest.json')).version}] } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already published/);
});

test('an earlier asynchronous upload blocks retry before any mutation', () => {
  const result = run('publish', { lastAsyncUploadState: 'IN_PROGRESS' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /An upload is still processing/);
});
test('a rejected revision allows a corrected package to reach archive validation', () => {
  const result = run('publish', { submittedItemRevisionStatus: { state: 'REJECTED' } });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /A submission already exists/);
  assert.match(result.stderr, /release-artifact/);
});

test('a corrected release uploads the tested ZIP and submits it for review', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');
  const root = await mkdtemp(`${tmpdir()}/cws-test-`);
  try {
    await mkdir(`${root}/extension`);
    await mkdir(`${root}/release-artifact`);
    await writeFile(`${root}/extension/manifest.json`, JSON.stringify({version:'1.0.0'}));
    const zip = spawnSync('zip', ['-q', `${root}/release-artifact/switch-tab-1.0.0.zip`, 'manifest.json'], {cwd:`${root}/extension`});
    assert.equal(zip.status, 0);
    const preload = `
      import assert from 'node:assert/strict';
      let step = 0;
      globalThis.fetch = async (url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer test-token');
        step++;
        let body;
        if (step === 1) body = {submittedItemRevisionStatus:{state:'REJECTED'}};
        if (step === 2) {
          assert.match(url, /:upload$/);
          assert.equal(options.method, 'POST');
          assert.equal(options.body.subarray(0,2).toString(), 'PK');
          body = {uploadState:'SUCCEEDED',crxVersion:'1.0.0'};
        }
        if (step === 3) {
          assert.match(url, /:publish$/);
          assert.deepEqual(JSON.parse(options.body), {publishType:'DEFAULT_PUBLISH',skipReview:false,blockOnWarnings:true});
          body = {state:'PENDING_REVIEW'};
        }
        if (step === 4) body = {submittedItemRevisionStatus:{state:'PENDING_REVIEW'}};
        assert.ok(body);
        return {ok:true,json:async()=>body};
      };
      process.on('exit', () => assert.equal(step,4));
    `;
    const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, resolve('scripts/chrome-web-store.js'), 'publish'], {
      cwd:root, encoding:'utf8', env:{...process.env,GITHUB_STEP_SUMMARY:'',CWS_PUBLISHER_ID:'test',CWS_ITEM_ID:'test',CWS_ACCESS_TOKEN:'test-token'},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PENDING_REVIEW/);
  } finally {
    await rm(root, {recursive:true,force:true});
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentBridge } from '../extension/content-bridge.js';

test('reconnects an existing page once, including concurrent probes, without navigation', async () => {
  let installed = false, injections = 0;
  const bridge = new ContentBridge({
    tabs: { get: async () => ({ url: 'https://example.test' }), sendMessage: async () => {
      if (!installed) throw new Error('Receiving end does not exist');
      return { safe: true, url: 'https://example.test', epoch: 0 };
    } },
    scripting: { executeScript: async request => {
      injections++; assert.equal(request.target.tabId, 1);
      assert.deepEqual(request.files, ['core.js', 'ui.js', 'content.js']);
      await new Promise(resolve => setImmediate(resolve)); installed = true;
    } },
  });
  const results = await Promise.all([bridge.status(1), bridge.status(1)]);
  assert.equal(injections, 1); assert.ok(results.every(result => result.safe));
  await bridge.status(1); assert.equal(injections, 1);
});

test('never injects into internal or incognito tabs, and never replaces a live unsafe response', async () => {
  for (const tab of [{ url: 'chrome://settings' }, { url: 'https://example.test', incognito: true }]) {
    const bridge = new ContentBridge({ tabs: { get: async () => tab, sendMessage: async () => { throw new Error('missing'); } },
      scripting: { executeScript: async () => assert.fail('must not inject') } });
    assert.equal(await bridge.status(1), null);
  }
  const bridge = new ContentBridge({ tabs: { sendMessage: async () => ({ safe: false }) },
    scripting: { executeScript: async () => assert.fail('must not replace live content') } });
  assert.equal((await bridge.status(1)).safe, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Previews, trimPreviews } from '../extension/previews.js';

function fixture() {
  const state = { previews: {} };
  const tab = { id: 1, active: true, incognito: false, url: 'https://example.test/', windowId: 1 };
  let calls = 0;
  const api = {
    storage: { session: {
      get: async () => structuredClone(state), set: async value => Object.assign(state, value),
    } },
    windows: { get: async () => ({ focused: true }) },
    tabs: {
      get: async () => ({ ...tab }),
      sendMessage: async () => ({ safe: true, url: tab.url }),
      captureVisibleTab: async () => { calls++; return 'data:image/jpeg;base64,'; },
    },
  };
  return { state, tab, api, manager: new Previews(api), calls: () => calls };
}

test('preview cache has count and byte limits', () => {
  const entries = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i, { at: i, image: 'a'.repeat(100000) }]));
  const result = trimPreviews(entries);
  assert.ok(Object.keys(result).length <= 20);
  assert.ok(Object.values(result).reduce((total, value) => total + value.image.length * 2, 0) < 4_000_000);
  assert.ok(result[29]); assert.equal(result[0], undefined);
});
test('cache cannot attach a screenshot to another URL or window', async () => {
  const { state, manager } = fixture();
  state.previews[1] = { image: 'image', url: 'https://example.test/', windowId: 1, at: 1 };
  assert.equal((await manager.attach([{ id: 1, url: 'https://example.test/' }], 1))[0].thumbnail, 'image');
  assert.equal((await manager.attach([{ id: 1, url: 'https://other.test/' }], 1))[0].thumbnail, null);
  assert.equal((await manager.attach([{ id: 1, url: 'https://example.test/' }], 2))[0].thumbnail, null);
  await manager.invalidate(1); assert.deepEqual(state.previews, {});
});
test('internal pages, inactive tabs, incognito and open overlays are never captured', async () => {
  for (const change of [{ url: 'chrome://settings' }, { active: false }, { incognito: true }]) {
    const f = fixture(); Object.assign(f.tab, change); await f.manager.capture(1); assert.equal(f.calls(), 0);
  }
  const f = fixture(); f.api.tabs.sendMessage = async () => ({ safe: false });
  await f.manager.capture(1); assert.equal(f.calls(), 0);
});
test('navigation during capture drops the result before decoding or storage', async () => {
  const f = fixture();
  f.api.tabs.captureVisibleTab = async () => {
    f.tab.url = 'https://new.test/'; await f.manager.invalidate(1); return 'not-an-image';
  };
  await f.manager.capture(1);
  assert.deepEqual(f.state.previews, {});
});
test('a switcher opened and closed during capture invalidates the image', async () => {
  const f = fixture(); let epoch = 0;
  f.api.tabs.sendMessage = async () => ({ safe: true, url: f.tab.url, epoch });
  f.api.tabs.captureVisibleTab = async () => { epoch++; return 'not-an-image'; };
  await f.manager.capture(1); assert.deepEqual(f.state.previews, {});
});

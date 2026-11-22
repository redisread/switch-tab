import test from 'node:test';
import assert from 'node:assert/strict';
import { CenteredSwitcher, centeredBounds, PANEL_KEY } from '../extension/centered.js';

function fixture() {
  const store = {};
  const source = { id: 7, windowId: 1, active: true, incognito: false };
  const windows = new Map([[1, { id: 1, left: 100, top: 100, width: 1000, height: 700 }]]);
  const api = {
    runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}`, sendMessage: async () => {} },
    storage: { session: {
      get: async key => ({ [key]: structuredClone(store[key]) }),
      set: async values => Object.assign(store, values),
      remove: async keys => { for (const key of [keys].flat()) delete store[key]; },
    } },
    tabs: { get: async () => source },
    windows: {
      get: async id => { if (!windows.has(id)) throw new Error('closed'); return windows.get(id); },
      create: async options => {
        const window = { ...options, id: 2, width: 600, focused: true, tabs: [{ id: 9 }] };
        windows.set(2, window); return window;
      },
      update: async (id, changes) => Object.assign(windows.get(id), changes),
      remove: async id => windows.delete(id),
    },
  };
  const data = { sourceId: 7, windowId: 1, token: 'token', ids: [8], tabs: [{ id: 8 }] };
  const sender = { id: 'extension', url: api.runtime.getURL('popup.html#token'), tab: { id: 9, windowId: 2 } };
  return { api, store, source, windows, data, sender, manager: new CenteredSwitcher(api) };
}
test('centering uses the source window, including negative monitor coordinates', () => {
  const bounds = centeredBounds({ left: -1200, top: 50, width: 1000, height: 700 }, 5);
  assert.equal(bounds.left + bounds.width / 2, -700);
  assert.equal(bounds.top + bounds.height / 2, 400);
});
test('actual native window size is used to recenter after creation', async () => {
  const f = fixture(); await f.manager.open(f.source, f.data, { delta: 1, shortcut: '⌘X' });
  const panel = f.windows.get(2);
  assert.equal(panel.left + panel.width / 2, 600);
  assert.equal(panel.top + panel.height / 2, 450);
});
test('panel ownership binds token, extension tab, focused window and original active source', async () => {
  const f = fixture(); await f.manager.open(f.source, f.data, { delta: 1, shortcut: '⌘X' });
  assert.equal((await f.manager.authorize(f.sender, 'token')).sourceId, 7);
  await assert.rejects(f.manager.authorize(f.sender, 'wrong'));
  await assert.rejects(f.manager.authorize({ ...f.sender, tab: { id: 11, windowId: 2 } }, 'token'));
  f.source.windowId = 3; await assert.rejects(f.manager.authorize(f.sender, 'token'));
  f.source.windowId = 1; f.source.active = false;
  await assert.rejects(f.manager.authorize(f.sender, 'token'));
  f.source.active = true; f.windows.get(2).focused = false;
  await assert.rejects(f.manager.authorize(f.sender, 'token'));
});
test('selection persists and closing removes only the switcher, optionally restores source focus', async () => {
  const f = fixture(); await f.manager.open(f.source, f.data, { delta: -1, shortcut: '⌘X' });
  await f.manager.step(1); assert.equal((await f.manager.get()).offset, 0);
  await f.manager.close(true);
  assert.equal(f.store[PANEL_KEY], undefined); assert.equal(f.windows.has(2), false);
  assert.equal(f.windows.get(1).focused, true);
});

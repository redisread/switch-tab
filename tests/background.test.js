import test from 'node:test';
import assert from 'node:assert/strict';

const store = {};
let listener, focused = true, lastFocused = 1;
const tabs = [
  { id: 1, windowId: 1, active: true, index: 0, lastAccessed: 30 },
  { id: 2, windowId: 1, active: false, index: 1, lastAccessed: 20 },
  { id: 3, windowId: 2, active: true, index: 0, lastAccessed: 10 },
];
let activated;
globalThis.chrome = {
  runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`,
    onMessage: { addListener: fn => { listener = fn; } } },
  commands: { onCommand: { addListener() {} } },
  tabs: {
    query: async query => tabs.filter(tab => (!query.active || tab.active) &&
      (query.windowId === undefined || tab.windowId === query.windowId) && (!query.currentWindow || tab.windowId === 1)),
    get: async id => { const tab = tabs.find(tab => tab.id === id); if (!tab) throw new Error('No tab'); return tab; },
    update: async id => { activated = id; }, onRemoved: { addListener() {} }, onActivated: { addListener() {} }, onUpdated: { addListener() {} }, onDetached: { addListener() {} },
  },
  windows: { get: async id => ({ id, focused }), getLastFocused: async () => ({ id: lastFocused }) },
  storage: { session: {
    get: async key => ({ [key]: store[key] }),
    set: async values => Object.assign(store, values),
    remove: async key => { delete store[key]; },
  } },
};
await import('../extension/background.js');
const content = { id: 'test', tab: tabs[0] };
const popup = { id: 'test', url: 'chrome-extension://test/popup.html' };
const message = (data, sender = content) => new Promise(resolve => listener(data, sender, resolve));

test('only a session candidate in the source window can be activated', async () => {
  const { data } = await message({ type: 'snapshot' });
  assert.deepEqual(data.ids, [2]);
  assert.equal((await message({ type: 'commit', token: data.token, targetId: 3 })).ok, false);
  assert.equal((await message({ type: 'commit', token: 'forged', targetId: 2 })).ok, false);
  assert.equal((await message({ type: 'commit', token: data.token, targetId: 2 })).ok, true);
  assert.equal(activated, 2);
  assert.equal((await message({ type: 'commit', token: data.token, targetId: 2 })).ok, false);
});
test('moved targets and background content frames cannot activate a tab', async () => {
  const { data } = await message({ type: 'snapshot' });
  tabs[1].windowId = 2;
  assert.equal((await message({ type: 'commit', token: data.token, targetId: 2 })).ok, false);
  tabs[1].windowId = 1;
  focused = false;
  assert.equal((await message({ type: 'snapshot' })).ok, false);
  focused = true;
});
test('native popup may own focus but must match the last focused browser window', async () => {
  focused = false;
  assert.equal((await message({ type: 'snapshot' }, popup)).ok, true);
  lastFocused = 2;
  assert.equal((await message({ type: 'snapshot' }, popup)).ok, false);
  lastFocused = 1; focused = true;
});

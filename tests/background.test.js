import test from 'node:test';
import assert from 'node:assert/strict';

const store = {};
let listener, onActivated, onFocusChanged, focused = true, lastFocused = 1;
const tabs = [
  { id: 1, windowId: 1, active: true, index: 0, lastAccessed: 30 },
  { id: 2, windowId: 1, active: false, index: 1, lastAccessed: 20 },
  { id: 3, windowId: 2, active: true, index: 0, lastAccessed: 10 },
];
let activated;
globalThis.chrome = {
  runtime: { onInstalled: { addListener() {} }, id: 'test', getURL: path => `chrome-extension://test/${path}`,
    onMessage: { addListener: fn => { listener = fn; } } },
  action: { onClicked: { addListener() {} } },
  commands: { onCommand: { addListener() {} } },
  tabs: {
    query: async query => tabs.filter(tab => (!query.active || tab.active) &&
      (query.windowId === undefined || tab.windowId === query.windowId) && (!query.currentWindow || tab.windowId === 1)),
    get: async id => { const tab = tabs.find(tab => tab.id === id); if (!tab) throw new Error('No tab'); return tab; },
    update: async id => { activated = id; }, onRemoved: { addListener() {} }, onActivated: { addListener(fn) { onActivated = fn; } }, onUpdated: { addListener() {} }, onDetached: { addListener() {} },
  },
  windows: { get: async id => ({ id, focused }), getLastFocused: async () => ({ id: lastFocused }), onRemoved: { addListener() {} }, onFocusChanged: { addListener(fn) { onFocusChanged = fn; } } },
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
test('unregistered extension pages cannot impersonate a source tab', async () => {
  assert.equal((await message({ type: 'panel-init', token: 'forged' }, popup)).ok, false);
});


test('a late preview request from a background tab cannot replace active capture work', async () => {
  const response = await message({ type: 'preview-request' }, { id: 'test', tab: tabs[1], frameId: 0 });
  assert.equal(response.ok, false);
  assert.match(response.error, /当前标签已变化/);
});


test('a tab activation supersedes a preview request still validating an older active snapshot', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const getTab = chrome.tabs.get, getWindow = chrome.windows.get;
  const queried = [];
  let finishWindow;
  chrome.tabs.get = async id => { queried.push(id); return structuredClone(await getTab(id)); };
  chrome.windows.get = () => new Promise(resolve => { finishWindow = resolve; });
  try {
    const response = message({ type: 'preview-request' }, { ...content, frameId: 0 });
    await new Promise(resolve => setImmediate(resolve));
    tabs[0].active = false; tabs[1].active = true;
    onActivated({ tabId: 2 });
    finishWindow({ id: 1, focused: true });
    assert.equal((await response).ok, true);
    t.mock.timers.tick(200); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(queried, [1, 2], 'The pending old request must not replace the newly activated tab');
  } finally {
    chrome.tabs.get = getTab; chrome.windows.get = getWindow;
    tabs[0].active = true; tabs[1].active = false;
  }
});


test('the newest window focus wins even when an older focus query completes first', async t => {
  await import('../extension/background.js?focus-race');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const queryTabs = chrome.tabs.query, getTab = chrome.tabs.get;
  const queries = new Map(), captured = [];
  chrome.tabs.query = ({ windowId }) => new Promise(resolve => queries.set(windowId, resolve));
  chrome.tabs.get = async id => { captured.push(id); return { id, active: true, url: 'chrome://settings' }; };
  try {
    onFocusChanged(1); onFocusChanged(2);
    queries.get(1)([{ id: 11 }]); await new Promise(resolve => setImmediate(resolve));
    queries.get(2)([{ id: 22 }]); await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(200); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(captured, [22]);
  } finally { chrome.tabs.query = queryTabs; chrome.tabs.get = getTab; }
});

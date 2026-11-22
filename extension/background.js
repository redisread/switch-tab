import './core.js';
import { Previews } from './previews.js';
import { CenteredSwitcher } from './centered.js';
import { ContentBridge } from './content-bridge.js';
const contentBridge = new ContentBridge(chrome);
const previews = new Previews(chrome, id => contentBridge.status(id));
const centered = new CenteredSwitcher(chrome);
let operations = Promise.resolve();
const enqueue = task => {
  const result = operations.then(task);
  operations = result.catch(() => {});
  return result;
};

const key = id => `session:${id}`;
const ownPage = sender => sender.id === chrome.runtime.id &&
  sender.url?.split('#')[0] === chrome.runtime.getURL('popup.html');

async function activeSource(sender) {
  if (ownPage(sender)) {
    const panel = await centered.authorize(sender, sender.url.split('#')[1]);
    return chrome.tabs.get(panel.sourceId);
  }
  const source = sender.tab;
  if (!source || source.incognito) throw new Error('当前窗口不可用');
  const current = await chrome.tabs.get(source.id);
  const window = await chrome.windows.get(current.windowId);
  if (!current.active || !window.focused) throw new Error('当前标签已变化，请重新打开');
  return current;
}

async function snapshot(sender) {
  const source = await activeSource(sender);
  const tabs = SwitchTab.candidates(await chrome.tabs.query({ windowId: source.windowId }), source);
  const session = { token: crypto.randomUUID(), sourceId: source.id, windowId: source.windowId,
    ids: tabs.map(tab => tab.id), created: Date.now() };
  await chrome.storage.session.set({ [key(source.id)]: session });
  return { ...session, tabs: await previews.attach(tabs, source.windowId) };
}

async function commit(message, sender) {
  const source = await activeSource(sender);
  const stored = (await chrome.storage.session.get(key(source.id)))[key(source.id)];
  if (!stored || stored.token !== message.token || !stored.ids.includes(message.targetId) ||
      Date.now() - stored.created > 600000) throw new Error('选择已过期，请重新打开');
  const target = await chrome.tabs.get(message.targetId);
  if (target.windowId !== source.windowId || target.incognito) throw new Error('标签已移到其他窗口');
  await chrome.tabs.update(target.id, { active: true });
  await chrome.storage.session.remove(key(source.id));
  return {};
}

async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id || (!sender.tab && !ownPage(sender))) return;
  if (message.type === 'preview-request' && sender.tab && sender.frameId === 0) {
    const generation = previews.generation;
    const source = await activeSource(sender);
    previews.schedule(source.id, generation); return {};
  }
  if (message.type === 'frame-key' && sender.tab) {
    // Keyboard events do not bubble out of an iframe. Relay only trusted
    // extension messages to its own top frame; no page postMessage bridge.
    await chrome.tabs.sendMessage(sender.tab.id, { type: 'frame-key', event: message.event }, { frameId: 0 });
    return {};
  }
  if (message.type === 'panel-init' && ownPage(sender)) return centered.authorize(sender, message.token);
  if (message.type === 'panel-step' && ownPage(sender)) {
    await centered.authorize(sender, message.token);
    if (![1, -1].includes(message.delta) && !Number.isInteger(message.index)) throw new Error('无效选择');
    return centered.step(message.delta, message.index);
  }
  if (message.type === 'panel-commit' && ownPage(sender)) {
    const record = await centered.authorize(sender, message.token);
    const targetId = record.ids[SwitchTab.wrap(record.offset, record.ids.length)];
    await commit({ token: record.token, targetId }, sender);
    await centered.close(true);
    return {};
  }
  if (message.type === 'panel-cancel' && ownPage(sender)) {
    const record = await centered.get();
    if (record?.token === message.token && sender.tab?.id === record.panelTabId) await centered.close(message.restore === true);
    return {};
  }
  if (message.type === 'snapshot' && !ownPage(sender)) return snapshot(sender);
  if (message.type === 'commit') return commit(message, sender);
  if (message.type === 'cancel') {
    const id = sender.tab?.id ?? message.sourceId;
    const stored = (await chrome.storage.session.get(key(id)))[key(id)];
    if (stored?.token === message.token) await chrome.storage.session.remove(key(id));
    return {};
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const result = message.type?.startsWith('panel-') ? enqueue(() => handle(message, sender)) : handle(message, sender);
  result.then(data => respond({ ok: true, data }),
    error => respond({ ok: false, error: error.message }));
  return true;
});

export function invoke(command, tab) { return enqueue(() => dispatch(command, tab)); }

async function dispatch(command, tab) {
  const source = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!source || source.incognito) return;
  const record = await centered.get();
  const delta = command === 'switch-previous' ? -1 : 1;
  const panelFocused = record && await chrome.windows.get(record.panelWindowId).then(window => window.focused, () => false);
  if (record && panelFocused && command !== 'toolbar' &&
      ((source.windowId === record.panelWindowId && source.id === record.panelTabId) ||
       (source.windowId === record.windowId && source.id === record.sourceId))) {
    await centered.step(delta); return;
  }
  await centered.close(false);
  const shortcuts = await chrome.commands.getAll();
  const message = { type: 'invoke', at: Date.now(), sourceId: source.id, delta,
    shortcut: shortcuts.find(item => item.name === command)?.shortcut || '' };
  if (command !== 'toolbar') {
    try {
      await contentBridge.status(source.id);
      const result = await chrome.tabs.sendMessage(source.id, message, { frameId: 0 });
      if (result?.handled) return;
    } catch { /* Restricted page or content script not yet loaded. */ }
  }
  await openCentered(source, message);
}

async function openCentered(source, message) {
  const data = await snapshot({ id: chrome.runtime.id, tab: source });
  await centered.open(source, data, message);
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (!['switch-next', 'switch-previous'].includes(command)) return;
  void invoke(command, tab).catch(error => console.warn('Switch Tab:', error.message));
});
chrome.action.onClicked.addListener(tab => {
  void invoke('toolbar', tab).catch(error => console.warn('Switch Tab:', error.message));
});
chrome.windows.onRemoved.addListener(id => {
  void enqueue(async () => {
    const record = await centered.get();
    if (record && (id === record.panelWindowId || id === record.windowId)) await centered.close(false);
  });
});
chrome.windows.onFocusChanged.addListener(id => {
  // Reserve at event time: an older window query must never win a later focus change.
  const generation = previews.cancelScheduled();
  if (id >= 0) void chrome.tabs.query({ windowId: id, active: true })
    .then(tabs => { if (tabs[0]) previews.schedule(tabs[0].id, generation); }).catch(() => {});
  void enqueue(async () => {
    const record = await centered.get();
    if (!record) return;
    const focused = await chrome.windows.get(record.panelWindowId).then(window => window.focused, () => false);
    if (!focused) await centered.close(false);
  });
});

chrome.tabs.onRemoved.addListener(id => {
  void chrome.storage.session.remove(key(id)); void previews.invalidate(id);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  // Invalidate any in-flight capture when the window switches away and back.
  for (const [id, revision] of previews.revisions) previews.revisions.set(id, revision + 1);
  previews.revisions.set(tabId, (previews.revisions.get(tabId) || 0) + 1);
  previews.schedule(tabId);
});
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (change.url || change.status === 'loading') void previews.invalidate(id);
  if (tab.active && change.status === 'complete') previews.schedule(id);
});
chrome.tabs.onDetached.addListener(id => { void previews.invalidate(id); });

// Reconnect the visible page after install/update, without refreshing user pages.
chrome.runtime.onInstalled.addListener(() => {
  const generation = previews.generation;
  void chrome.tabs.query({ active: true, lastFocusedWindow: true })
    .then(tabs => { if (tabs[0]) previews.schedule(tabs[0].id, generation); }).catch(() => {});
});

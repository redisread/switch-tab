import './core.js';

const key = id => `session:${id}`;
const ownPage = sender => sender.id === chrome.runtime.id &&
  sender.url === chrome.runtime.getURL('popup.html');

async function activeSource(sender) {
  const source = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!source || source.incognito) throw new Error('当前窗口不可用');
  const current = await chrome.tabs.get(source.id);
  const window = await chrome.windows.get(current.windowId);
  // On macOS the native popup can own focus while its browser window reports
  // focused=false. It must still belong to the last focused browser window.
  const focused = ownPage(sender)
    ? (await chrome.windows.getLastFocused()).id === current.windowId
    : window.focused;
  if (!current.active || !focused) throw new Error('当前标签已变化，请重新打开');
  return current;
}

async function snapshot(sender) {
  const source = await activeSource(sender);
  const tabs = SwitchTab.candidates(await chrome.tabs.query({ windowId: source.windowId }), source);
  const session = { token: crypto.randomUUID(), sourceId: source.id, windowId: source.windowId,
    ids: tabs.map(tab => tab.id), created: Date.now() };
  await chrome.storage.session.set({ [key(source.id)]: session });
  return { ...session, tabs };
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
  if (message.type === 'frame-key' && sender.tab) {
    // Keyboard events do not bubble out of an iframe. Relay only trusted
    // extension messages to its own top frame; no page postMessage bridge.
    await chrome.tabs.sendMessage(sender.tab.id, { type: 'frame-key', event: message.event }, { frameId: 0 });
    return {};
  }
  if (message.type === 'snapshot') return snapshot(sender);
  if (message.type === 'commit') return commit(message, sender);
  if (message.type === 'cancel') {
    const id = sender.tab?.id ?? message.sourceId;
    const stored = (await chrome.storage.session.get(key(id)))[key(id)];
    if (stored?.token === message.token) await chrome.storage.session.remove(key(id));
    return {};
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(data => respond({ ok: true, data }),
    error => respond({ ok: false, error: error.message }));
  return true;
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!['switch-next', 'switch-previous'].includes(command)) return;
  const at = Date.now();
  void (async () => {
    const source = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!source || source.incognito) return;
    const shortcuts = await chrome.commands.getAll();
    const message = { type: 'invoke', at, sourceId: source.id,
      delta: command === 'switch-previous' ? -1 : 1,
      shortcut: shortcuts.find(item => item.name === command)?.shortcut || '' };
    // An already-open popup owns its selection, even over an ordinary page.
    const popup = await chrome.runtime.sendMessage(message).catch(() => null);
    if (popup?.handled) return;
    try {
      const result = await chrome.tabs.sendMessage(source.id, message, { frameId: 0 });
      if (result?.handled) return;
    } catch { /* No content script: browser page, store, or pre-install tab. */ }
    await chrome.storage.session.set({ popupInvocation: message });
    await chrome.action.openPopup({ windowId: source.windowId });
  })().catch(error => console.warn('Switch Tab:', error.message));
});

chrome.tabs.onRemoved.addListener(id => { void chrome.storage.session.remove(key(id)); });

const token = location.hash.slice(1);
let data, ui, offset = 0, version = -1, committing = false, releaseKey = null;
let pending = Promise.resolve();
const releasedKeys = new Set();
const send = async message => {
  const result = await chrome.runtime.sendMessage({ ...message, token });
  if (!result?.ok) throw new Error(result?.error || '切换窗口不可用');
  return result.data;
};
const apply = state => {
  if (state.version < version) return;
  version = state.version; offset = state.offset;
  if (data) ui?.select(SwitchTab.wrap(offset, data.tabs.length));
};
const fail = error => {
  if (ui) ui.error(`${error.message} · Esc 关闭后重试`);
  else document.querySelector('#mount').textContent = error.message;
};
const select = (delta, index) => {
  pending = pending.then(() => send({ type: 'panel-step', delta, index })).then(apply);
  pending.catch(fail);
};
const cancel = restore => {
  void send({ type: 'panel-cancel', restore }).catch(() => window.close());
};
async function confirm() {
  if (committing || !data?.tabs.length) return;
  committing = true;
  try {
    await pending;
    await send({ type: 'panel-commit' });
  } catch (error) { committing = false; fail(error); }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id === chrome.runtime.id && message.type === 'panel-state' && message.token === token) apply(message);
});
window.addEventListener('keyup', event => {
  if (!event.isTrusted || !['Meta', 'Alt'].includes(event.key)) return;
  releasedKeys.add(event.key);
  if (event.key === releaseKey) void confirm();
}, true);
window.addEventListener('keydown', event => {
  releasedKeys.delete(event.key);
  if (event.key === 'Escape') { event.preventDefault(); cancel(true); return; }
  if (event.key === 'Enter' && event.target.id !== 'shortcuts') { event.preventDefault(); void confirm(); }
  if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault(); select(['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1);
  }
});
let hasFocused = document.hasFocus();
window.addEventListener('focus', () => { hasFocused = true; });
window.addEventListener('blur', () => { if (hasFocused && !committing) cancel(false); });
document.querySelector('#shortcuts').addEventListener('click', async () => {
  await chrome.tabs.create({ windowId: data.windowId, url: 'chrome://extensions/shortcuts' });
  cancel(true);
});

(async () => {
  try {
    data = await send({ type: 'panel-init' });
    apply(data);
    releaseKey = SwitchTab.releaseKey(data.shortcut);
    if (releasedKeys.has(releaseKey)) { await confirm(); return; }
    ui = new SwitchTabUI({ mount: document.querySelector('#mount'), tabs: data.tabs, popup: true,
      hint: releaseKey ? `松开 ${releaseKey === 'Meta' ? '⌘' : '⌥'} 确认 · ←→ 选择 · Esc 取消` : 'Enter 确认 · ←→ 选择 · Esc 取消',
      onChoose: index => { select(0, index); void confirm(); }, onCancel: () => cancel(true) });
    ui.select(SwitchTab.wrap(offset, data.tabs.length));
  } catch (error) { fail(error); }
})();

let data, ui, offset = 0, committing = false;
const send = message => chrome.runtime.sendMessage(message);
const select = delta => {
  offset += delta;
  if (data) ui?.select(SwitchTab.wrap(offset, data.tabs.length));
};

async function confirm() {
  if (committing || !data?.tabs.length) return;
  committing = true;
  try {
    const result = await send({ type: 'commit', token: data.token,
      targetId: data.tabs[SwitchTab.wrap(offset, data.tabs.length)].id });
    if (!result?.ok) throw new Error(result?.error || '切换失败');
    window.close();
  } catch (error) { committing = false; ui.error(`${error.message} · 请关闭后重试`); }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id === chrome.runtime.id && message.type === 'invoke' && (!data || data.sourceId === message.sourceId)) {
    select(message.delta); respond({ handled: true });
  }
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') { window.close(); return; }
  if (event.key === 'Enter' && event.target.id !== 'shortcuts') { event.preventDefault(); void confirm(); }
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault(); select(event.key === 'ArrowUp' ? -1 : 1);
  }
});
document.querySelector('#shortcuts').addEventListener('click', () => {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); window.close();
});

(async () => {
  try {
    const result = await send({ type: 'snapshot' });
    if (!result?.ok) throw new Error(result?.error || '无法读取标签');
    data = result.data;
    const { popupInvocation } = await chrome.storage.session.get('popupInvocation');
    await chrome.storage.session.remove('popupInvocation');
    if (popupInvocation?.sourceId === data.sourceId && Date.now() - popupInvocation.at < 2000 && popupInvocation.delta < 0) offset--;
    ui = new SwitchTabUI({ mount: document.querySelector('#mount'), tabs: data.tabs, popup: true,
      hint: 'Enter 确认 · ↑↓ 选择 · Esc 取消',
      onChoose: index => { offset = index; void confirm(); }, onCancel: () => window.close() });
    ui.select(SwitchTab.wrap(offset, data.tabs.length));
  } catch (error) {
    document.querySelector('#mount').textContent = `${error.message}，请关闭后重试。`;
  }
})();

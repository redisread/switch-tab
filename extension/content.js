(() => {
  const topFrame = window === window.top;
  const release = { down: 0, up: 0, consumed: 0 };
  let session = null;
  const send = message => chrome.runtime.sendMessage(message);

  function cancel(restore = true) {
    const old = session;
    session = null;
    if (!old) return;
    clearTimeout(old.timer);
    old.ui?.close(false);
    old.focusAnchor?.remove();
    if (restore && old.previousFocus?.isConnected) old.previousFocus.focus({ preventScroll: true });
    if (old.data) void send({ type: 'cancel', ...old.data }).catch(() => {});
  }

  function show(current) {
    if (session !== current || !current.data || current.ui) return;
    current.ui = new SwitchTabUI({ mount: document.documentElement, tabs: current.data.tabs,
      hint: current.option ? '松开 ⌥ 确认 · Shift 反向 · Esc 取消' : 'Enter 确认 · ↑↓ 选择 · Esc 取消',
      onChoose: index => { current.offset = index; void confirm(); }, onCancel: () => cancel() });
    current.ui.select(SwitchTab.wrap(current.offset, current.data.tabs.length));
  }

  async function confirm() {
    const current = session;
    if (!current || current.committing) return;
    current.confirmed = true;
    if (!current.data) return; // A release during the worker round trip is retained.
    const target = current.data.tabs[SwitchTab.wrap(current.offset, current.data.tabs.length)];
    if (!target) { cancel(); return; }
    current.committing = true;
    try {
      const result = await send({ type: 'commit', token: current.data.token, targetId: target.id });
      if (!result?.ok) throw new Error(result?.error || '切换失败，请重试');
      if (session === current) cancel(false);
    } catch (error) {
      if (session !== current) return;
      current.committing = false; current.confirmed = false;
      show(current); current.ui?.error(`${error.message} · Esc 关闭后重试`);
    }
  }

  async function invoke(message) {
    if (session) {
      if (session.committing) return;
      session.offset += message.delta;
      session.ui?.select(SwitchTab.wrap(session.offset, session.data.tabs.length));
      return;
    }
    const current = { offset: message.delta < 0 ? -1 : 0, option: SwitchTab.usesOption(message.shortcut),
      started: Date.now(), confirmed: false, committing: false };
    session = current;
    // Own keyboard focus immediately, including while the panel is delayed.
    // Otherwise Enter in a focused iframe could also submit its underlying form.
    current.previousFocus = document.activeElement;
    current.focusAnchor = document.createElement('div');
    current.focusAnchor.tabIndex = -1;
    current.focusAnchor.setAttribute('aria-label', '正在选择最近标签');
    current.focusAnchor.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.documentElement.append(current.focusAnchor);
    current.focusAnchor.focus({ preventScroll: true });
    if (current.option && SwitchTab.released(release, message.at)) {
      current.confirmed = true; release.consumed = release.up;
    }
    try {
      const result = await send({ type: 'snapshot' });
      if (!result?.ok) throw new Error(result?.error || '无法读取标签');
      current.data = result.data;
      if (session !== current) {
        void send({ type: 'cancel', ...result.data }).catch(() => {}); return;
      }
      if (!current.data.tabs.length) { cancel(); return; }
      if (current.confirmed) { await confirm(); return; }
      current.timer = setTimeout(() => show(current), Math.max(0, 150 - (Date.now() - current.started)));
    } catch (error) {
      if (session !== current) return;
      current.data = { tabs: [] };
      show(current); current.ui?.error(`${error.message} · Esc 关闭`);
    }
  }

  function observe(event) {
    if (event.key === 'Alt') {
      if (event.type === 'keydown') release.down = event.at;
      else {
        release.up = event.at;
        if (session?.option) { release.consumed = event.at; void confirm(); }
      }
    }
    if (!session || event.type !== 'keydown') return;
    if (event.key === 'Escape') cancel();
    else if (event.key === 'Enter') void confirm();
    else if (['ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) {
      session.offset += event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1;
      session.ui?.select(SwitchTab.wrap(session.offset, session.data.tabs.length));
    }
  }

  for (const type of ['keydown', 'keyup']) {
    window.addEventListener(type, event => {
      if (!event.isTrusted) return;
      if (!['Alt', 'Escape', 'Enter', 'ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) return;
      const data = { type, key: event.key, shiftKey: event.shiftKey, at: Date.now() };
      if (topFrame) {
        if (session && event.key !== 'Alt') { event.preventDefault(); event.stopImmediatePropagation(); }
        observe(data);
      } else if (event.key === 'Alt') {
        // Relay only modifier state. Confirmation/navigation belongs exclusively
        // to the top-frame focus anchor, never to an underlying iframe form.
        void send({ type: 'frame-key', event: data }).catch(() => {});
      }
    }, true);
  }
  if (!topFrame) return;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'invoke') {
      // The omnibox owns Enter/keyup while focused. Use the native popup there.
      if (!document.hasFocus()) { respond({ handled: false }); return; }
      respond({ handled: true }); void invoke(message);
    } else if (message.type === 'frame-key') observe(message.event);
  });
  window.addEventListener('blur', () => { release.down = 0; cancel(false); });
  window.addEventListener('pointerdown', () => { if (session && !session.ui) cancel(false); }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(false); });
  window.addEventListener('pagehide', () => cancel(false));
})();

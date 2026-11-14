export const PANEL_KEY = 'centeredSwitcher';

export function centeredBounds(source, count) {
  const width = Math.min(1040, Math.max(280, source.width || 1040), Math.max(280, count * 200 + 32));
  const height = Math.min(280, source.height || 280);
  return { width, height,
    left: Math.round((source.left || 0) + ((source.width || width) - width) / 2),
    top: Math.round((source.top || 0) + ((source.height || height) - height) / 2) };
}

export class CenteredSwitcher {
  constructor(api) { this.api = api; }
  async get() { return (await this.api.storage.session.get(PANEL_KEY))[PANEL_KEY]; }
  async save(record) { await this.api.storage.session.set({ [PANEL_KEY]: record }); }
  async open(source, data, invocation) {
    await this.close(false);
    if (!data.tabs.length) return;
    const origin = await this.api.windows.get(source.windowId);
    const created = await this.api.windows.create({
      url: this.api.runtime.getURL(`popup.html#${data.token}`), type: 'popup', focused: true,
      ...centeredBounds(origin, data.tabs.length),
    });
    // Chrome/macOS may enforce a minimum native window size. Recenter using
    // the actual outer dimensions rather than assuming the requested size won.
    const actual = await this.api.windows.get(created.id);
    await this.api.windows.update(created.id, {
      left: Math.round((origin.left || 0) + ((origin.width || actual.width) - actual.width) / 2),
      top: Math.round((origin.top || 0) + ((origin.height || actual.height) - actual.height) / 2),
    }).catch(() => { /* The OS may clamp positions for a partly off-screen source. */ });
    const record = { ...data, panelWindowId: created.id, panelTabId: created.tabs[0].id,
      offset: invocation.delta < 0 ? -1 : 0, version: 0, shortcut: invocation.shortcut };
    await this.save(record);
    return record;
  }
  async authorize(sender, token) {
    const record = await this.get();
    if (!record || token !== record.token || sender.id !== this.api.runtime.id ||
        sender.url !== this.api.runtime.getURL(`popup.html#${record.token}`) ||
        sender.tab?.id !== record.panelTabId || sender.tab?.windowId !== record.panelWindowId) {
      throw new Error('切换窗口已过期，请重新打开');
    }
    const panel = await this.api.windows.get(record.panelWindowId);
    const source = await this.api.tabs.get(record.sourceId);
    if (!panel.focused || !source.active || source.windowId !== record.windowId || source.incognito) {
      throw new Error('来源标签已变化，请重新打开');
    }
    return record;
  }
  async step(delta, index) {
    const record = await this.get();
    if (!record) return;
    record.offset = Number.isInteger(index) ? index : record.offset + delta;
    record.version++;
    await this.save(record);
    await this.api.runtime.sendMessage({ type: 'panel-state', token: record.token,
      offset: record.offset, version: record.version }).catch(() => {});
    return record;
  }
  async close(restore) {
    const record = await this.get();
    if (!record) return;
    await this.api.storage.session.remove([PANEL_KEY, `session:${record.sourceId}`]);
    await this.api.windows.remove(record.panelWindowId).catch(() => {});
    if (restore) await this.api.windows.update(record.windowId, { focused: true }).catch(() => {});
  }
}

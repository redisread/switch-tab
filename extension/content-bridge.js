// Reconnect pages that were already open when the extension was installed/reloaded.
// Injection stays in Chrome's isolated world and never reloads or activates a tab.
export class ContentBridge {
  constructor(api) { this.api = api; this.pending = new Map(); }
  async status(id) {
    const api = this.api;
    const probe = () => api.tabs.sendMessage(id, { type: 'preview-safe' }, { frameId: 0 });
    try { return await probe(); } catch {
      const tab = await api.tabs.get(id);
      if (tab.incognito || !/^https?:\/\//.test(tab.url || '')) return null;
      if (!this.pending.has(id)) {
        const install = api.scripting.executeScript({
          target: { tabId: id, allFrames: true },
          files: ['core.js', 'ui.js', 'content.js'],
        }).finally(() => this.pending.delete(id));
        this.pending.set(id, install);
      }
      await this.pending.get(id);
      return probe();
    }
  }
}

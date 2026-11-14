/* Shared by the isolated content world, popup, worker, and Node tests. */
globalThis.SwitchTab = {
  candidates(tabs, source) {
    return tabs.filter(tab => tab.id !== source.id && tab.windowId === source.windowId && !tab.incognito)
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.index - b.index)
      .slice(0, 5)
      .map(({ id, title, url }) => ({ id, title: title || '未命名标签', url: url || '' }));
  },
  wrap(index, size) { return size ? ((index % size) + size) % size : -1; },
  domain(url) {
    try { return new URL(url).hostname || new URL(url).protocol; }
    catch { return '浏览器标签'; }
  },
  usesOption(shortcut) { return shortcut.includes('⌥') || /(^|\+)(Alt|Option)(\+|$)/i.test(shortcut); },
  // Only consume observed releases; a timeout is never evidence of a release.
  released({ down, up, consumed }, invokedAt) {
    return up > consumed && up >= down && down > 0 && up >= invokedAt - 1000;
  }
};

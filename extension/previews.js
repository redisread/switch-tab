// Session-only thumbnails. Capture never activates a tab and never records
// internal pages, incognito windows, or a switcher already on screen.
export function trimPreviews(entries) {
  let bytes = 0;
  return Object.fromEntries(Object.entries(entries).sort((a, b) => b[1].at - a[1].at)
    .filter(([, value], index) => {
      bytes += value.image.length * 2;
      return index < 20 && bytes < 4_000_000;
    }));
}

export class Previews {
  constructor(api, status = id => api.tabs.sendMessage(id, { type: 'preview-safe' }, { frameId: 0 })) {
    this.status = status;
    this.generation = 0;
    this.api = api;
    this.revisions = new Map();
    this.writes = Promise.resolve();
    this.lastCapture = 0;
  }
  write(change) {
    this.writes = this.writes.catch(() => {}).then(async () => {
      const { previews = {} } = await this.api.storage.session.get('previews');
      change(previews);
      await this.api.storage.session.set({ previews: trimPreviews(previews) });
    });
    return this.writes;
  }
  invalidate(id) {
    this.revisions.set(id, (this.revisions.get(id) || 0) + 1);
    return this.write(entries => { delete entries[id]; });
  }
  cancelScheduled() {
    clearTimeout(this.timer);
    return ++this.generation;
  }
  schedule(id, expectedGeneration = this.generation) {
    if (expectedGeneration !== this.generation) return;
    const generation = this.cancelScheduled();
    const attempt = async remaining => {
      const captured = await this.capture(id).catch(() => false);
      // A new tab/request replaces this job; never resurrect an obsolete capture.
      if (!captured && remaining && generation === this.generation) {
        this.timer = setTimeout(() => { void attempt(remaining - 1); }, 750);
      }
    };
    this.timer = setTimeout(() => { void attempt(2); }, 200);
  }
  async capture(id) {
    if (this.busy) return false;
    this.busy = true;
    try { return await this.captureNow(id); } finally { this.busy = false; }
  }
  async captureNow(id) {
    if (Date.now() - this.lastCapture < 650) return;
    this.lastCapture = Date.now();
    const api = this.api;
    const tab = await api.tabs.get(id);
    if (!tab.active || tab.incognito || !/^https?:\/\//.test(tab.url || '')) return;
    if (!(await api.windows.get(tab.windowId)).focused) return;
    const revision = this.revisions.get(id) || 0;
    this.revisions.set(id, revision);
    const safe = await this.status(id);
    if (!safe?.safe || safe.url !== tab.url) return;
    const image = await api.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 65 });
    const current = await api.tabs.get(id);
    const after = await this.status(id);
    if (!current.active || current.url !== tab.url || !after?.safe || after.epoch !== safe.epoch ||
        (this.revisions.get(id) || 0) !== revision) return;
    const bitmap = await createImageBitmap(await (await fetch(image)).blob());
    const width = Math.min(480, bitmap.width);
    const canvas = new OffscreenCanvas(width, Math.max(1, Math.round(bitmap.height * width / bitmap.width)));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const thumbnail = `data:image/jpeg;base64,${btoa(binary)}`;
    let saved = false;
    await this.write(entries => {
      if ((this.revisions.get(id) || 0) === revision) {
        entries[id] = { image: thumbnail, url: tab.url, windowId: tab.windowId, at: Date.now() };
        saved = true;
      }
    });
    return saved;
  }
  async attach(tabs, windowId) {
    const { previews = {} } = await this.api.storage.session.get('previews');
    return tabs.map(tab => ({ ...tab, thumbnail:
      previews[tab.id]?.url === tab.url && previews[tab.id]?.windowId === windowId
        ? previews[tab.id].image : null }));
  }
}

globalThis.SwitchTabUI = class {
  constructor({ mount, tabs, onChoose, onCancel, hint, popup = false }) {
    this.host = document.createElement('div');
    this.host.style.cssText = popup ? 'display:block' :
      'all:initial;position:fixed;inset:0;z-index:2147483647;display:block;';
    this.root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { color-scheme: light dark; }
      * { box-sizing:border-box; }
      .backdrop { position:fixed;inset:0;background:rgba(15,23,42,.18);display:grid;place-items:center;padding:20px; }
      .panel { width:440px;max-width:100%;padding:20px 12px 12px;border:1px solid #dadde5;border-radius:20px;background:#fafbfe;color:#202637;box-shadow:0 24px 80px #11182730;font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
      .popup { width:380px;border:0;border-radius:0;box-shadow:none; }
      header { padding:0 10px 14px;display:flex;justify-content:space-between;align-items:center; }
      h1 { margin:0;font-size:16px;font-weight:650;letter-spacing:-.3px; }
      .count { color:#626c80;font-size:12px; }
      .list { outline:none;display:grid;gap:4px; }
      .row { display:flex;align-items:center;gap:12px;width:100%;padding:12px;border:1px solid transparent;border-radius:12px;text-align:left;color:inherit;cursor:pointer; }
      .row[aria-selected=true] { background:#e9edff;border-color:#c8d2ff; }
      .row:hover { background:#edf0f7; }
      .icon { flex-shrink:0;width:36px;height:36px;display:grid;place-items:center;border-radius:10px;background:#fff;color:#48597b;border:1px solid #e3e6ee;font-size:17px;font-weight:600; }
      img { width:20px;height:20px;object-fit:contain; }
      .text { min-width:0;flex:1; }
      .title { white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:550; }
      .domain { color:#626c80;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px; }
      .mark { color:#4c5be2;font-size:16px;visibility:hidden; }
      [aria-selected=true] .mark { visibility:visible; }
      footer { padding:14px 10px 2px;color:#626c80;font-size:11px; }
      .empty { padding:28px 12px;text-align:center;color:#626c80; }
      @media(prefers-color-scheme:dark) {
        .panel { background:#20232d;color:#f0f2fa;border-color:#414756; }
        .count,.domain,footer,.empty { color:#b3bbcd; }
        .row[aria-selected=true] { background:#343b61;border-color:#5967a6; }
        .row:hover { background:#303644; }
        .icon { background:#2b303d;border-color:#424a5d;color:#d5dcf0; }
        .mark { color:#aab5ff; }
      }`;
    this.root.append(style);
    const backdrop = document.createElement('div');
    if (!popup) backdrop.className = 'backdrop';
    const panel = document.createElement('section');
    panel.className = `panel${popup ? ' popup' : ''}`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '最近使用的标签');
    const header = document.createElement('header');
    const title = document.createElement('h1');
    title.textContent = '最近使用';
    const count = document.createElement('span');
    count.className = 'count'; count.textContent = `${tabs.length} 个标签`;
    header.append(title, count);
    this.list = document.createElement('div');
    this.list.className = 'list'; this.list.tabIndex = 0;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', '选择要切换的标签');
    this.rows = tabs.map((tab, index) => {
      const row = document.createElement('div');
      row.className = 'row'; row.id = `switch-tab-option-${index}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      const icon = document.createElement('span'); icon.className = 'icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = SwitchTab.domain(tab.url).slice(0, 1).toUpperCase();
      if (/^https?:/.test(tab.url)) {
        const image = document.createElement('img'); image.alt = '';
        // Chrome's local favicon service, never a remote favicon provider.
        image.src = `${chrome.runtime.getURL('_favicon/')}?pageUrl=${encodeURIComponent(tab.url)}&size=32`;
        image.onerror = () => { image.remove(); icon.textContent = '↗'; };
        icon.replaceChildren(image);
      }
      const text = document.createElement('div'); text.className = 'text';
      const name = document.createElement('div'); name.className = 'title'; name.textContent = tab.title;
      const domain = document.createElement('div'); domain.className = 'domain'; domain.textContent = SwitchTab.domain(tab.url);
      text.append(name, domain);
      const mark = document.createElement('span'); mark.className = 'mark'; mark.textContent = '↵'; mark.setAttribute('aria-hidden', 'true');
      row.append(icon, text, mark); row.addEventListener('click', () => onChoose(index));
      this.list.append(row); return row;
    });
    if (!tabs.length) {
      const empty = document.createElement('div'); empty.className = 'empty';
      empty.textContent = '当前窗口没有其他标签'; this.list.append(empty);
    }
    this.footer = document.createElement('footer'); this.footer.textContent = hint;
    this.footer.setAttribute('role', 'status');
    panel.append(header, this.list, this.footer); backdrop.append(panel); this.root.append(backdrop);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) onCancel(); });
    mount.append(this.host);
    this.previousFocus = document.activeElement;
    this.list.focus({ preventScroll: true });
  }
  select(index) {
    this.rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === index)));
    if (this.rows[index]) this.list.setAttribute('aria-activedescendant', this.rows[index].id);
  }
  error(message) { this.footer.textContent = message; }
  close(restore = true) {
    this.host.remove();
    if (restore && this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }
};

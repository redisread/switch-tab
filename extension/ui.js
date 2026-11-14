globalThis.SwitchTabUI = class {
  constructor({ mount, tabs, onChoose, onCancel, hint, popup = false }) {
    this.host = document.createElement('div');
    this.host.style.cssText = popup ? 'display:block' :
      'all:initial;position:fixed;inset:0;z-index:2147483647;display:block;';
    this.root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { color-scheme:light dark; }
      * { box-sizing:border-box; }
      .backdrop { position:fixed;inset:0;background:rgba(22,20,32,.12);display:grid;place-items:center;padding:24px; }
      .panel { width:max-content;max-width:min(1140px,100%);padding:12px;border:1px solid #ffffff80;border-radius:22px;background:rgba(237,238,241,.97);color:#292535;box-shadow:0 24px 80px #1c142a38,0 4px 16px #1c142a18;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
      .popup { width:100%;max-width:100%;border:0;border-radius:0;box-shadow:none; }
      header { display:none; }
      .popup .list { width:max-content;max-width:100%;margin:auto; }
      .list { outline:none;display:flex;gap:6px;padding:2px;overflow-x:auto;overscroll-behavior:contain;scrollbar-width:thin;max-width:100%; }
      .row { flex:0 0 194px;width:194px;min-width:0;padding:9px;border:2px solid transparent;border-radius:10px;text-align:left;color:inherit;cursor:pointer;background:transparent; }
      .row[aria-selected=true] { border-color:#9eb8c5;background:#cbdde5;box-shadow:none; }
      .caption { display:flex;align-items:center;gap:8px;padding:10px 2px 1px; }
      .icon { flex-shrink:0;width:20px;height:20px;display:grid;place-items:center;border-radius:5px;color:#655785;font-size:14px;font-weight:600; }
      .icon img { width:18px;height:18px;object-fit:contain; }
      .text { min-width:0;flex:1; }
      .title { white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;font-weight:600; }
      .domain { display:none; }
      .preview { height:112px;width:100%;overflow:hidden;position:relative;border-radius:8px;background:linear-gradient(145deg,#e9e4f2,#dcd5eb); }
      .thumbnail { display:block;width:100%;height:100%;object-fit:cover;object-position:top;outline:1px solid #0000001a;outline-offset:-1px; }
      .placeholder { height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#655d76;font-size:11px; }
      .placeholder strong { font-size:30px;font-weight:500; }
      .mark { color:#655785;font-size:13px;visibility:hidden; }
      [aria-selected=true] .mark { visibility:visible; }
      footer { position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%); }
      footer.error { position:static;width:auto;height:auto;clip-path:none;padding:10px;color:#625a71;font-size:12px; }
      .empty { padding:32px;text-align:center;color:#625a71; }
      @media(hover:hover) { .row:hover { background:#fff; } }
      @media(prefers-color-scheme:dark) {
        .panel { background:rgba(26,27,29,.97);color:#f1edf8;border-color:#ffffff1f; }
        .row { background:transparent; }
        .row[aria-selected=true] { background:#3b515d;border-color:#6b8999; }
        .preview { background:linear-gradient(145deg,#494054,#38313f); }
        .placeholder,footer,.empty { color:#c7bdce; }
        .icon,.mark { color:#d5c4eb; }
        .thumbnail { outline-color:#ffffff1a; }
        @media(hover:hover) { .row:hover { background:#343b40; } }
      }
      @media(forced-colors:active) { .row[aria-selected=true] { border-color:Highlight; } }
      @media(max-width:500px) { .backdrop { padding:12px; } .panel { padding:12px; } .row { flex-basis:174px;width:174px; } }
    `;
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
    this.list.setAttribute('aria-orientation', 'horizontal');
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
      const caption = document.createElement('div'); caption.className = 'caption';
      caption.append(icon, text, mark);
      const preview = document.createElement('div'); preview.className = 'preview';
      const placeholder = () => {
        const empty = document.createElement('div'); empty.className = 'placeholder';
        const letter = document.createElement('strong'); letter.textContent = SwitchTab.domain(tab.url).slice(0, 1).toUpperCase();
        const label = document.createElement('span'); label.textContent = '暂无预览';
        empty.append(letter, label); preview.replaceChildren(empty);
      };
      if (tab.thumbnail?.startsWith('data:image/jpeg;base64,')) {
        const image = document.createElement('img'); image.className = 'thumbnail';
        image.alt = ''; image.src = tab.thumbnail; image.onerror = placeholder;
        preview.append(image);
      } else placeholder();
      preview.setAttribute('aria-hidden', 'true');
      row.title = `${tab.title} — ${SwitchTab.domain(tab.url)}`;
      row.append(preview, caption); row.addEventListener('click', () => onChoose(index));
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
    if (this.rows[index]) {
      this.list.setAttribute('aria-activedescendant', this.rows[index].id);
      this.rows[index].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
  }
  error(message) { this.footer.classList.add('error'); this.footer.textContent = message; }
  close(restore = true) {
    this.host.remove();
    if (restore && this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }
};

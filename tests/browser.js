import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  if (req.url === '/frame') {
    res.end('<!doctype html><title>Frame</title><form onsubmit="window.submitted=true;return false"><input aria-label="Frame note"><button>Submit</button></form>'); return;
  }
  const colors = { '/A': '#c8dcf3', '/B': '#f0d5bb', '/C': '#dad2ed' };
  res.end(`<!doctype html><html><head><title>Tab ${req.url.slice(1)}</title></head>
    <body style="font:18px system-ui;padding:48px;background:${colors[req.url] || '#f0f3f9'};color:#243145"><small>SWITCH TAB / LOCAL TEST</small><h1 style="font-size:52px;letter-spacing:-2px;margin:18px 0">Tab ${req.url.slice(1)}</h1><p>Your recent work, one shortcut away.</p><div style="display:flex;gap:20px;margin:32px 0"><div style="background:#ffffffb0;border-radius:18px;padding:26px;width:35%"><h2>Notes & ideas</h2><p>A place for everything<br>you want to return to.</p><input aria-label="Note" placeholder="Write here"></div><div style="background:#ffffff70;border-radius:18px;padding:26px;width:35%"><h2>Recently visited</h2><p>Keep your focus.<br>Pick up where you left off.</p></div></div><iframe style="margin-top:600px" src="/frame"></iframe></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'switch-tab-test-'));
const extension = join(profile, 'extension');
await cp(resolve('extension'), extension, { recursive: true });
// Test-only worker entry invokes the same production router as Chrome events.
await writeFile(join(extension, 'driver.js'), `import { invoke } from './background.js';
import { Previews } from './previews.js';
const capture = Previews.prototype.captureNow;
globalThis.captureDiagnostics = [];
Previews.prototype.captureNow = async function(id) {
  const tab = await chrome.tabs.get(id);
  const entry = { id, url: tab.url, active: tab.active, focused: (await chrome.windows.get(tab.windowId)).focused };
  globalThis.captureDiagnostics.push(entry);
  try { await capture.call(this, id); } catch (error) { entry.error = error.message; throw error; }
  entry.saved = Boolean((await chrome.storage.session.get('previews')).previews?.[id]);
};
globalThis.driver = { invoke };`);
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
manifest.background.service_worker = 'driver.js';
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', viewport: null, headless: process.env.HEADED !== '1',
  // Xvfb has no hardware GPU; use software rendering for reliable image readback.
  args: [ ...(process.platform === 'linux' ? ['--disable-gpu'] : []),
    `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // The serviceworker event can precede module evaluation and listener registration.
  await expect.poll(() => worker.evaluate(() => typeof globalThis.driver?.invoke),
    { timeout: 10000, message: 'Background module ready' }).toBe('function');
  const shortcuts = await worker.evaluate(() => chrome.commands.getAll());
  const actualShortcut = shortcuts.find(item => item.name === 'switch-next').shortcut;
  assert.ok(actualShortcut, 'Default shortcut must be assigned');
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Alt';
  console.log('Registered shortcut:', actualShortcut);
  const errors = [];
  const pages = [];
  for (const name of ['A', 'B', 'C']) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.bringToFront();
    await expect.poll(() => worker.evaluate(async () => {
      const window = await chrome.windows.getLastFocused();
      await chrome.windows.update(window.id, { focused: true });
      return (await chrome.windows.get(window.id)).focused;
    }), { timeout: 10000, message: 'Native browser window focused before navigation' }).toBe(true);
    await page.waitForFunction(() => document.hasFocus(), undefined, { timeout: 10000 });
    await page.goto(`${base}/${name}`); await page.bringToFront(); pages.push(page);
    // Wait for actual capture completion before activation invalidates an in-flight image.
    await expect.poll(() => worker.evaluate(async url => {
      const { previews = {} } = await chrome.storage.session.get('previews');
      return Object.values(previews).some(entry => entry.url === url && entry.image.startsWith('data:image/jpeg;base64,'));
    }, `${base}/${name}`), { timeout: 10000, message: `Capture preview for Tab ${name}` }).toBe(true).catch(async error => {
      console.error('Capture diagnostics:', await worker.evaluate(() => globalThis.captureDiagnostics));
      throw error;
    });

  }
  const [a, b, c] = pages;
  const previews = await worker.evaluate(async () => (await chrome.storage.session.get('previews')).previews);
  assert.ok(Object.values(previews || {}).filter(value => value.image.startsWith('data:image/jpeg;base64,')).length >= 3, 'Visited tabs must have actual captured thumbnails');
  console.log('PASS real thumbnail capture');
  const active = () => worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].title);
  const waitActive = async title => {
    for (let n = 0; n < 50; n++) { if (await active() === title) return; await new Promise(r => setTimeout(r, 50)); }
    assert.equal(await active(), title);
  };
  const invoke = (delta = 1, shortcut = actualShortcut) => worker.evaluate(async ({ delta, shortcut }) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'invoke', delta, shortcut, at: Date.now(), sourceId: tab.id }, { frameId: 0 });
  }, { delta, shortcut });
  // Exercise the real extension content world, worker messages, tabs and storage APIs.
  // Command delivery is injected here; OS keyboard dispatch is a separate manual check.
  await c.keyboard.down(modifier); await invoke(); await c.keyboard.up(modifier);
  await waitActive('Tab B');
  await b.keyboard.down(modifier); await invoke(); await b.keyboard.up(modifier);
  await waitActive('Tab C');
  console.log('PASS quick release / MRU toggle');

  await c.keyboard.down(modifier); await invoke(); await invoke();
  await c.waitForTimeout(220);
  await mkdir('test-results', { recursive: true });
  await c.screenshot({ path: 'test-results/switcher.png' });
  assert.equal(await active(), 'Tab C');
  await c.keyboard.up(modifier); await waitActive('Tab A');
  console.log('PASS delayed overlay / frozen order / cycle');

  await a.keyboard.down(modifier); await invoke(); await a.keyboard.press('Escape'); await a.keyboard.up(modifier);
  assert.equal(await active(), 'Tab A');
  console.log('PASS Escape cancellation');

  await invoke(1, 'Ctrl+J'); await a.waitForTimeout(180); await a.keyboard.press('Enter');
  await waitActive('Tab C');
  console.log('PASS custom shortcut Enter fallback');

  await c.keyboard.down(modifier); await invoke(-1); await invoke();
  await c.keyboard.up(modifier); await waitActive('Tab A');
  console.log('PASS reverse wraps without reordering candidates');

  await a.keyboard.down(modifier); await a.keyboard.up(modifier); await invoke();
  await waitActive('Tab C');
  console.log('PASS observed release preceding command delivery');

  await c.frameLocator('iframe').getByRole('textbox').focus();
  await invoke(1, 'Ctrl+J'); await c.keyboard.press('Enter');
  await waitActive('Tab A');
  assert.equal(await c.frames()[1].evaluate(() => Boolean(window.submitted)), false);
  console.log('PASS immediate iframe confirmation never submits underlying form');
  await c.bringToFront();

  await c.keyboard.down(modifier); await invoke();
  await b.bringToFront(); await b.keyboard.up(modifier);
  await b.waitForTimeout(200); assert.equal(await active(), 'Tab B');
  console.log('PASS focus loss cancels pending switch');

  // Remove the selected target while the session is open: never activate another.
  await b.keyboard.down(modifier); await invoke(); await c.close();
  await b.keyboard.up(modifier); await b.waitForTimeout(200);
  assert.equal(await active(), 'Tab B'); await b.keyboard.press('Escape');
  console.log('PASS closed target fails safely');

  // Exercise the actual fallback by opening a registered independent window.
  // Use the exported router so this includes source binding and session creation.
  const panelPagePromise = context.waitForEvent('page');
  panelPagePromise.catch(() => {});
  const sourceWindow = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const bounds = await chrome.windows.get(tab.windowId);
    await Promise.all([driver.invoke('toolbar', tab), driver.invoke('switch-next', tab)]);
    return bounds;
  });
  const popup = await panelPagePromise;
  await popup.waitForLoadState();
  await popup.waitForTimeout(300);
  const panelState = await worker.evaluate(async () => {
    const { centeredSwitcher } = await chrome.storage.session.get('centeredSwitcher');
    return { record: centeredSwitcher, window: await chrome.windows.get(centeredSwitcher.panelWindowId) };
  });
  assert.equal(panelState.record.offset, 1, 'Repeat queued before panel focus must advance rather than reopen');
  assert.ok(Math.abs(panelState.window.left + panelState.window.width / 2 - (sourceWindow.left + sourceWindow.width / 2)) <= 2);
  assert.ok(Math.abs(panelState.window.top + panelState.window.height / 2 - (sourceWindow.top + sourceWindow.height / 2)) <= 2);
  assert.equal(await popup.locator('#mount').evaluate(el => el.childElementCount), 1,
    await popup.locator('#mount').textContent());
  console.log('PASS centered independent window with fixed source');
  await popup.screenshot({ path: 'test-results/popup.png' });
  const layout = await popup.evaluate(() => {
    const cards = ui.rows.map(row => ({ x: row.getBoundingClientRect().x, y: row.getBoundingClientRect().y }));
    const row = ui.rows[0];
    return { cards, previewAboveCaption: row.querySelector('.preview').getBoundingClientRect().bottom <= row.querySelector('.caption').getBoundingClientRect().top,
      horizontal: ui.list.getAttribute('aria-orientation') };
  });
  assert.equal(layout.horizontal, 'horizontal'); assert.equal(layout.previewAboveCaption, true);
  assert.ok(layout.cards.slice(1).every((card, i) => card.x > layout.cards[i].x && card.y === layout.cards[i].y));
  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup.screenshot({ path: 'test-results/popup-dark.png' });
  console.log('PASS horizontal preview-first card layout / dark theme');
  await popup.keyboard.press('Escape');
  await b.bringToFront();

  await b.goto('chrome://version');
  const releasePanelPromise = context.waitForEvent('page');
  releasePanelPromise.catch(() => {});
  await worker.evaluate(async shortcut => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await driver.invoke('switch-next', tab);
  }, actualShortcut);
  const releasePanel = await releasePanelPromise;
  await releasePanel.waitForLoadState(); await releasePanel.waitForTimeout(150);
  await releasePanel.keyboard.down(modifier);
  await releasePanel.keyboard.press('x');
  assert.equal(await active(), 'Switch Tab'); // X release alone does not commit.
  await releasePanel.keyboard.up(modifier);
  await waitActive('Tab A');
  console.log('PASS centered window commits on modifier release, not X release');

  // Slow only the panel's init response; release while its UI data is pending.
  await context.addInitScript(() => {
    if (location.pathname !== '/popup.html' || location.protocol !== 'chrome-extension:') return;
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async message => {
      const result = await send(message);
      if (message.type === 'panel-init') await new Promise(resolve => setTimeout(resolve, 800));
      return result;
    };
  });
  await b.bringToFront();
  const earlyPagePromise = context.waitForEvent('page'); earlyPagePromise.catch(() => {});
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await driver.invoke('switch-next', tab);
  });
  const earlyPage = await earlyPagePromise; await earlyPage.waitForLoadState();
  assert.equal(await earlyPage.evaluate(() => typeof data), 'undefined');
  await earlyPage.keyboard.down(modifier); await earlyPage.keyboard.up(modifier);
  await waitActive('Tab A');
  console.log('PASS modifier release during pending panel initialization');

  if (process.env.HEADED === '1') {
  const blurPagePromise = context.waitForEvent('page'); blurPagePromise.catch(() => {});
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await driver.invoke('toolbar', tab);
  });
  const blurPage = await blurPagePromise; await blurPage.waitForLoadState();
  await blurPage.waitForTimeout(900);
  const closed = blurPage.waitForEvent('close', { timeout: 5000 }); closed.catch(() => {});
  const otherId = await worker.evaluate(async url => (await chrome.windows.create({ url, focused: true })).id, `${base}/other`);
  await worker.evaluate(id => chrome.windows.update(id, { focused: true }), otherId);
  await closed;
  assert.equal(await worker.evaluate(async () => (await chrome.windows.getLastFocused()).id), otherId);
  assert.equal(await worker.evaluate(async () => Boolean((await chrome.storage.session.get('centeredSwitcher')).centeredSwitcher)), false);
  await worker.evaluate(id => chrome.windows.remove(id), otherId);
  console.log('PASS focus loss closes the switcher without stealing another window focus');
  } else console.log('SKIP native window focus: run npm run test:browser:headed');
  assert.deepEqual(errors, []);
} finally {
  await context.close(); await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}

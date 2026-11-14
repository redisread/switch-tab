import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  if (req.url === '/frame') {
    res.end('<!doctype html><title>Frame</title><form onsubmit="window.submitted=true;return false"><input aria-label="Frame note"><button>Submit</button></form>'); return;
  }
  res.end(`<!doctype html><html><head><title>Tab ${req.url.slice(1)}</title></head>
    <body style="font:20px system-ui;padding:80px;background:#f0f3f9"><h1>Tab ${req.url.slice(1)}</h1><input aria-label="Note" placeholder="Write here"><p>Switch Tab integration fixture</p><iframe src="/frame"></iframe></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'switch-tab-test-'));
const extension = resolve('extension');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: process.env.HEADED !== '1',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const shortcuts = await worker.evaluate(() => chrome.commands.getAll());
  const actualShortcut = shortcuts.find(item => item.name === 'switch-next').shortcut;
  assert.ok(actualShortcut, 'Default shortcut must be assigned');
  const errors = [];
  const pages = [];
  for (const name of ['A', 'B', 'C']) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/${name}`); await page.bringToFront(); pages.push(page);
  }
  const [a, b, c] = pages;
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
  await c.keyboard.down('Alt'); await invoke(); await c.keyboard.up('Alt');
  await waitActive('Tab B');
  await b.keyboard.down('Alt'); await invoke(); await b.keyboard.up('Alt');
  await waitActive('Tab C');
  console.log('PASS quick release / MRU toggle');

  await c.keyboard.down('Alt'); await invoke(); await invoke();
  await c.waitForTimeout(220);
  await mkdir('test-results', { recursive: true });
  await c.screenshot({ path: 'test-results/switcher.png' });
  assert.equal(await active(), 'Tab C');
  await c.keyboard.up('Alt'); await waitActive('Tab A');
  console.log('PASS delayed overlay / frozen order / cycle');

  await a.keyboard.down('Alt'); await invoke(); await a.keyboard.press('Escape'); await a.keyboard.up('Alt');
  assert.equal(await active(), 'Tab A');
  console.log('PASS Escape cancellation');

  await invoke(1, 'Command+J'); await a.waitForTimeout(180); await a.keyboard.press('Enter');
  await waitActive('Tab C');
  console.log('PASS custom shortcut Enter fallback');

  await c.keyboard.down('Alt'); await invoke(-1); await invoke();
  await c.keyboard.up('Alt'); await waitActive('Tab A');
  console.log('PASS reverse wraps without reordering candidates');

  await a.keyboard.down('Alt'); await a.keyboard.up('Alt'); await invoke();
  await waitActive('Tab C');
  console.log('PASS observed release preceding command delivery');

  await c.frameLocator('iframe').getByRole('textbox').focus();
  await invoke(1, 'Command+J'); await c.keyboard.press('Enter');
  await waitActive('Tab A');
  assert.equal(await c.frames()[1].evaluate(() => Boolean(window.submitted)), false);
  console.log('PASS immediate iframe confirmation never submits underlying form');
  await c.bringToFront();

  await c.keyboard.down('Alt'); await invoke();
  await b.bringToFront(); await b.keyboard.up('Alt');
  await b.waitForTimeout(200); assert.equal(await active(), 'Tab B');
  console.log('PASS focus loss cancels pending switch');

  // Remove the selected target while the session is open: never activate another.
  await b.keyboard.down('Alt'); await invoke(); await c.close();
  await b.keyboard.up('Alt'); await b.waitForTimeout(200);
  assert.equal(await active(), 'Tab B'); await b.keyboard.press('Escape');
  console.log('PASS closed target fails safely');

  const nativePopupSource = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.storage.session.remove(`session:${tab.id}`);
    await chrome.action.openPopup();
    return tab.id;
  });
  let nativeSession;
  for (let n = 0; n < 40; n++) {
    nativeSession = await worker.evaluate(async id => (await chrome.storage.session.get(`session:${id}`))[`session:${id}`], nativePopupSource);
    if (nativeSession) break;
    await b.waitForTimeout(50);
  }
  assert.ok(nativeSession?.token, 'Native action popup must create a valid selection session');
  await a.bringToFront();
  console.log('PASS actual action popup opens and reads source window');

  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForTimeout(200);
  await popup.screenshot({ path: 'test-results/popup.png' });
  assert.equal(await popup.locator('#mount').evaluate(el => el.childElementCount), 1);
  console.log('PASS popup renders with real extension API');
  assert.deepEqual(errors, []);
} finally {
  await context.close(); await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}

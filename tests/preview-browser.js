import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><title>Existing ${req.url.slice(1)}</title><body style="background:${req.url === '/A' ? '#bfd8ed' : '#f4d5ba'};font:28px system-ui;padding:50px"><h1>Existing ${req.url.slice(1)}</h1><p>This page was opened before the extension connected.</p><input placeholder="Unsaved text"></body>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'switch-tab-existing-'));
const extension = join(profile, 'extension');
await cp(resolve('extension'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
// Model pages predating install/reload: no declarative script and no capture scheduled yet.
manifest.content_scripts = [];
manifest.background.service_worker = 'driver.js';
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
await writeFile(join(extension, 'driver.js'), `
import { invoke } from './background.js';
import { Previews } from './previews.js';
let enabled = false;
globalThis.captureLog = [];
const capture = Previews.prototype.captureNow;
Previews.prototype.captureNow = async function(id) {
  const tab = await chrome.tabs.get(id);
  const entry = { id, url: tab.url, active: tab.active, focused: (await chrome.windows.get(tab.windowId)).focused };
  captureLog.push(entry);
  try { entry.saved = await capture.call(this, id); }
  catch (error) { entry.error = error.message; throw error; }
  return entry.saved;
};
const schedule = Previews.prototype.schedule;
Previews.prototype.schedule = function(...args) { if (enabled) schedule.apply(this, args); };
globalThis.driver = { start: () => { enabled = true; }, invoke };
const originalCapture = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
globalThis.captureAttempts = 0;
chrome.tabs.captureVisibleTab = async (...args) => {
  if (++globalThis.captureAttempts === 1) throw new Error('Failed to capture tab: image readback failed');
  return originalCapture(...args);
};
`);
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', viewport: null, headless: process.env.HEADED !== '1',
  args: [...(process.platform === 'linux' ? ['--disable-gpu'] : []),
    `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await expect.poll(() => worker.evaluate(() => typeof globalThis.driver?.start)).toBe('function');
  const pages = [];
  for (const name of ['A', 'B', 'C']) {
    const page = await context.newPage(); await page.goto(`${base}/${name}`);
    await page.locator('input').fill(`Keep ${name}`); pages.push(page);
  }
  const before = await worker.evaluate(async base => {
    const tabs = await chrome.tabs.query({});
    return Promise.all(tabs.filter(tab => tab.url.startsWith(base)).map(async tab => {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'preview-safe' }); return false; } catch { return true; }
    }));
  }, base);
  assert.deepEqual(before, [true, true, true]);
  await worker.evaluate(() => driver.start());
  for (const [index, page] of pages.entries()) {
    await page.bringToFront();
    await expect.poll(() => worker.evaluate(async url => {
      const [tab] = await chrome.tabs.query({ url });
      await chrome.windows.update(tab.windowId, { focused: true });
      return (await chrome.windows.get(tab.windowId)).focused;
    }, page.url()), { timeout: 10000 }).toBe(true);
    await page.waitForFunction(() => document.hasFocus(), undefined, { timeout: 10000 });
    await expect.poll(() => worker.evaluate(async url => {
      const { previews = {} } = await chrome.storage.session.get('previews');
      return Object.values(previews).some(entry => entry.url === url && entry.image.startsWith('data:image/jpeg;base64,'));
    }, page.url()), { timeout: 10000, message: `Recover existing page ${index}` }).toBe(true).catch(async error => {
      console.error(await worker.evaluate(() => captureLog)); throw error;
    });
    assert.equal(await page.locator('input').inputValue(), `Keep ${['A', 'B', 'C'][index]}`);
  }
  assert.ok(await worker.evaluate(() => captureAttempts) >= 4);
  console.log('PASS missing content scripts recover without refresh; unsaved input retained; transient capture retries');

  const popupPromise = context.waitForEvent('page'); popupPromise.catch(() => {});
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await driver.invoke('toolbar', tab);
  });
  const popup = await popupPromise;
  await popup.waitForFunction(() => typeof ui !== 'undefined' && ui?.rows.length > 0, undefined, { timeout: 10000 });
  const thumbnails = await popup.evaluate(async () => {
    const images = [...ui.root.querySelectorAll('.thumbnail')];
    await Promise.all(images.map(image => image.decode()));
    return images.map(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
  });
  assert.equal(thumbnails.length, 2);
  assert.ok(thumbnails.every(image => image.width > 0 && image.width <= 480 && image.height > 0));
  await mkdir('test-results', { recursive: true });
  await popup.screenshot({ path: 'test-results/recovered-thumbnails.png' });
  await popup.keyboard.press('Escape');
  console.log('PASS recovered thumbnails decode and render in the real switcher');

  // Reload the actual extension while the existing pages and their form state remain open.
  const extensionUrl = await worker.evaluate(() => chrome.runtime.getURL('popup.html'));
  const settings = await context.newPage();
  await settings.goto('chrome://extensions');
  await settings.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
  await settings.close();
  const nextWorker = context.waitForEvent('serviceworker', { predicate: next => next !== worker, timeout: 10000 });
  nextWorker.catch(() => {});
  await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
  const wakePage = await context.newPage();
  await wakePage.goto(extensionUrl);
  const reloaded = await nextWorker;
  await wakePage.close();
  await expect.poll(() => reloaded.evaluate(() => typeof globalThis.driver?.start), { timeout: 10000 }).toBe('function');
  await reloaded.evaluate(() => driver.start());
  await pages[1].bringToFront();
  await pages[0].bringToFront();
  await expect.poll(() => reloaded.evaluate(async url => {
    const { previews = {} } = await chrome.storage.session.get('previews');
    return Object.values(previews).some(entry => entry.url === url && entry.image.startsWith('data:image/jpeg;base64,'));
  }, pages[0].url()), { timeout: 10000, message: 'Recover after actual extension reload' }).toBe(true);
  assert.equal(await pages[0].locator('input').inputValue(), 'Keep A');
  console.log('PASS actual extension reload recovers existing page without navigation');
} finally {
  await context.close(); server.close(); await rm(profile, { recursive: true, force: true });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/core.js';
const { candidates, wrap, released, usesOption } = globalThis.SwitchTab;
const tab = (id, lastAccessed, extra = {}) => ({ id, index: id, windowId: 1, lastAccessed, ...extra });

test('MRU excludes source, other windows and incognito, limits to five', () => {
  const tabs = [tab(1, 100), tab(2, 90), tab(3, 80), tab(4, 70), tab(5, 60), tab(6, 50), tab(7, 40),
    tab(8, 200, { windowId: 2 }), tab(9, 300, { incognito: true })];
  assert.deepEqual(candidates(tabs, tabs[0]).map(t => t.id), [2, 3, 4, 5, 6]);
});
test('equal or missing timestamps use stable tab-strip order', () => {
  assert.deepEqual(candidates([tab(4), tab(2), tab(3, 10), tab(1, 10)], tab(0)).map(t => t.id), [1, 3, 2, 4]);
});
test('reverse and forward cycle; empty window is a no-op', () => {
  assert.equal(wrap(-1, 5), 4); assert.equal(wrap(5, 5), 0); assert.equal(wrap(0, 0), -1);
  assert.deepEqual(candidates([tab(1)], tab(1)), []);
});
test('release before command delivery is consumed only once and must be observed', () => {
  assert.equal(released({ down: 1000, up: 1020, consumed: 0 }, 1050), true);
  assert.equal(released({ down: 1000, up: 1020, consumed: 1020 }, 1050), false);
  assert.equal(released({ down: 0, up: 0, consumed: 0 }, 1050), false);
  assert.equal(released({ down: 1100, up: 1020, consumed: 0 }, 1150), false);
  assert.equal(released({ down: 1000, up: 1020, consumed: 0 }, 3000), false);
});
test('custom shortcuts without Option do not promise release confirmation', () => {
  assert.equal(usesOption('⌥+Q'), true); assert.equal(usesOption('Alt+Shift+Q'), true);
  assert.equal(usesOption('⌥Q'), true); assert.equal(usesOption('⌥⇧Q'), true);
  assert.equal(usesOption('Option+Q'), true); assert.equal(usesOption('Command+Q'), false);
});
test('Command and Option release keys match actual Chrome shortcut encodings', () => {
  assert.equal(SwitchTab.releaseKey('⌘X'), 'Meta');
  assert.equal(SwitchTab.releaseKey('⌘⇧X'), 'Meta');
  assert.equal(SwitchTab.releaseKey('Command+X'), 'Meta');
  assert.equal(SwitchTab.releaseKey('Alt+X'), 'Alt');
  assert.equal(SwitchTab.releaseKey('Ctrl+J'), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consumeColdMiss,
  forgetTab,
  formerGroupOf,
  noteGroup,
  rebuildGroupCache,
} from '../dist/worker/groupCache.js';

test('重建保护查询窗口内的新归属，未变化的缓存仍可对账', async () => {
  globalThis.chrome = { tabs: { async query() { return []; } } };
  const firstRebuild = rebuildGroupCache();
  noteGroup(100, 5);
  await firstRebuild;
  assert.equal(formerGroupOf(100), 5);

  chrome.tabs.query = async () => [{ id: 100, groupId: 5 }];
  const secondRebuild = rebuildGroupCache();
  noteGroup(100, 6);
  await secondRebuild;
  assert.equal(formerGroupOf(100), 6);

  chrome.tabs.query = async () => [{ id: 100, groupId: 7 }];
  await rebuildGroupCache();
  assert.equal(formerGroupOf(100), 7);

  const finalRebuild = rebuildGroupCache();
  forgetTab(100);
  await finalRebuild;
  assert.equal(formerGroupOf(100), undefined);
  assert.equal(consumeColdMiss(), true);
});

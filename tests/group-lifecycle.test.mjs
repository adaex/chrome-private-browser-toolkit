import assert from 'node:assert/strict';
import test from 'node:test';

import { createEventRegistry, createProxyIndicatorMock, createStorage, flush, snapshot } from './helpers.mjs';

test('取消分组与主动清空都保留最后有效归档', async () => {
  const { listeners, event } = createEventRegistry();
  const tab1 = { id: 101, groupId: 1, windowId: 1, index: 0, url: 'https://example.com/1', title: '一' };
  const tab2 = { id: 102, groupId: 2, windowId: 1, index: 1, url: 'https://example.com/2', title: '二' };
  const tabsByGroup = new Map([[1, [tab1]], [2, [tab2]]]);
  const local = createStorage({
    'tabg:meta': { lastInitAt: Date.now() },
    'tabg:g:1': snapshot,
    'tabg:g:2': { ...snapshot, id: 2 },
  });
  globalThis.chrome = {
    ...createProxyIndicatorMock(),
    tabs: {
      async query(filter) {
        return filter.groupId ? (tabsByGroup.get(filter.groupId) ?? []) : [tab1, tab2];
      },
      onCreated: event('created'),
      onUpdated: event('updated'),
      onRemoved: event('removed'),
      onDetached: event('detached'),
    },
    tabGroups: {
      onUpdated: event('groupUpdated'),
      onRemoved: event('groupRemoved'),
    },
    storage: { local },
  };

  await import('../dist/worker/index.js');
  await flush();

  // 两种操作都先有备份和离组事件，再删除组；主动清空最后才收到 tabRemoved
  for (const { tab, closeLastTab } of [
    { tab: tab1, closeLastTab: false },
    { tab: tab2, closeLastTab: true },
  ]) {
    const groupId = tab.groupId;
    listeners.updated(tab.id, { status: 'complete' }, tab);
    tabsByGroup.set(groupId, []);
    listeners.updated(tab.id, { groupId: -1 }, { ...tab, groupId: -1 });
    listeners.groupRemoved({ id: groupId });
    if (closeLastTab) listeners.removed(tab.id, { isWindowClosing: false });
    await flush();
    await flush();

    assert.equal(local.data[`tabg:g:${groupId}`], undefined);
    const archives = Object.keys(local.data).filter(key => key.startsWith(`tabg:a:${groupId}:`));
    assert.equal(archives.length, 1);
    assert.deepEqual(local.data[archives[0]].tabs, snapshot.tabs);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEventRegistry, createProxyIndicatorMock, createStorage, flush } from './helpers.mjs';

test('一次性代理切换页创建和 URL 更新时不执行去重或全屏吸附', async () => {
  const { listeners, event } = createEventRegistry();
  const local = createStorage({ 'tabg:meta': { lastInitAt: Date.now() } });
  let tabQueries = 0;
  let windowReads = 0;
  globalThis.chrome = {
    ...createProxyIndicatorMock(),
    runtime: {
      getURL: path => `chrome-extension://test-extension/${path}`,
      onMessage: { addListener() {} },
    },
    tabs: {
      async query() {
        tabQueries++;
        return [];
      },
      onCreated: event('created'),
      onUpdated: event('updated'),
      onRemoved: event('removed'),
      onDetached: event('detached'),
    },
    windows: {
      async getAll() {
        windowReads++;
        return [];
      },
    },
    tabGroups: {
      onUpdated: event('groupUpdated'),
      onRemoved: event('groupRemoved'),
    },
    storage: { local },
  };

  await import('../dist/worker/index.js');
  await flush();
  tabQueries = 0;
  windowReads = 0;

  const switchUrl = 'chrome-extension://test-extension/switch.html?mode=direct';
  listeners.created({
    id: 100,
    groupId: -1,
    index: 0,
    windowId: 1,
    pendingUrl: switchUrl,
  });
  await flush();
  listeners.updated(100, { url: switchUrl }, { id: 100, groupId: -1, url: switchUrl });
  await flush();

  assert.equal(tabQueries, 0);
  assert.equal(windowReads, 0);
});

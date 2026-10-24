import assert from 'node:assert/strict';
import test from 'node:test';

import { createEventRegistry, createStorage, flush } from './helpers.mjs';

test('无痕 split 进程不注册业务监听，也不启动查询、代理操作或备份', async () => {
  const { listeners, event } = createEventRegistry();
  const local = createStorage();
  let tabQueries = 0;
  let proxyReads = 0;
  globalThis.chrome = {
    extension: { inIncognitoContext: true },
    action: {
      async setIcon() {},
      async setTitle() {},
    },
    proxy: {
      settings: {
        onChange: event('proxySettings'),
        async get() {
          proxyReads++;
          return { value: { mode: 'direct' }, levelOfControl: 'controlled_by_this_extension' };
        },
      },
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
    tabGroups: {
      onUpdated: event('groupUpdated'),
      onRemoved: event('groupRemoved'),
    },
    storage: { local },
  };

  await import('../dist/worker/index.js');
  await flush();

  assert.equal(tabQueries, 0);
  assert.equal(proxyReads, 0);
  assert.equal(Object.keys(listeners).length, 0);
  assert.equal(local.writes.length, 0);
  assert.equal(local.removals.length, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEventRegistry, createStorage, flush } from './helpers.mjs';

test('onCreated 写入的归属不会被稍晚返回的启动旧快照清掉', async () => {
  const { listeners, event } = createEventRegistry();
  let resolveInitial;
  let firstQuery = true;
  const initialQuery = new Promise(resolve => { resolveInitial = resolve; });
  const local = createStorage({ 'tabg:meta': { lastInitAt: Date.now() } });
  globalThis.chrome = {
    action: { onClicked: event('action') },
    tabs: {
      async query() {
        if (firstQuery) {
          firstQuery = false;
          return initialQuery;
        }
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
  listeners.created({ id: 100, groupId: 5, index: 1, windowId: 1 });
  resolveInitial([]);
  await flush();

  const { formerGroupOf } = await import('../dist/worker/groupCache.js');
  assert.equal(formerGroupOf(100), 5);
});

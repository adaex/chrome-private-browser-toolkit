import assert from 'node:assert/strict';
import test from 'node:test';

import { createEventRegistry, createStorage, flush, group } from './helpers.mjs';

test('备份按组合并、纯折叠不重写，功能开关无需重启即可生效', async () => {
  const { listeners, event } = createEventRegistry();
  let tab = {
    id: 1,
    groupId: group.id,
    windowId: 1,
    index: 0,
    status: 'complete',
    title: '旧标题',
    url: 'https://example.com/',
  };
  let allTabQueries = 0;
  const local = createStorage({ 'tabg:meta': { lastInitAt: Date.now() } });
  globalThis.chrome = {
    action: { onClicked: event('action') },
    tabs: {
      async query(filter) {
        if (!filter.groupId) allTabQueries++;
        return [tab];
      },
      onCreated: event('created'),
      onUpdated: event('updated'),
      onRemoved: event('removed'),
      onDetached: event('detached'),
    },
    tabGroups: {
      async get() { return group; },
      onUpdated: event('groupUpdated'),
      onRemoved: event('groupRemoved'),
    },
    storage: { local },
  };

  await import('../dist/worker/index.js');
  await flush();
  allTabQueries = 0;

  tab = { ...tab, title: '标题一' };
  listeners.updated(tab.id, { title: tab.title }, tab);
  tab = { ...tab, title: '标题二' };
  listeners.updated(tab.id, { title: tab.title }, tab);
  await flush();
  assert.equal(local.writes.length, 1);
  assert.equal(local.data['tabg:g:1'].tabs[0].title, '标题二');

  listeners.groupUpdated(group);
  await flush();
  assert.equal(local.writes.length, 2);
  listeners.groupUpdated({ ...group, collapsed: true });
  await flush();
  assert.equal(local.writes.length, 2);

  local.data.featureSettings = { deduplicate: false, fullscreen: true };
  listeners.updated(tab.id, { url: 'https://example.com/next' }, { ...tab, url: 'https://example.com/next' });
  await flush();
  assert.equal(allTabQueries, 0);
});

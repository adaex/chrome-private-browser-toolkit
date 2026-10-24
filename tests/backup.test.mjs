import assert from 'node:assert/strict';
import test from 'node:test';

import { archiveGroup, backupGroup, initBackupAllGroups } from '../dist/worker/backup.js';
import { forgetGroupObject, noteGroupObject } from '../dist/worker/groupCache.js';
import { createStorage, group, snapshot } from './helpers.mjs';

test('归档写入失败时保留旧 active 快照', async () => {
  const local = createStorage(
    { 'tabg:meta': { lastInitAt: 0 }, 'tabg:g:1': snapshot },
    { failSet: values => Object.keys(values).some(key => key.startsWith('tabg:a:')) },
  );
  globalThis.chrome = {
    storage: { local },
    tabGroups: { async query() { return []; } },
  };

  await assert.rejects(initBackupAllGroups([], false));
  assert.deepEqual(local.data['tabg:g:1'], snapshot);
  assert.equal(local.removals.length, 0);
});

for (const cached of [true, false]) {
  test(`空组删除语义不受组对象缓存影响（cached=${cached}）`, async () => {
    const local = createStorage({ 'tabg:g:1': snapshot });
    let groupReads = 0;
    globalThis.chrome = {
      storage: { local },
      tabs: { async query() { return []; } },
      tabGroups: {
        async get() {
          groupReads++;
          throw new Error('组已不存在');
        },
      },
    };
    forgetGroupObject(group.id);
    if (cached) noteGroupObject(group);

    await backupGroup(group.id);
    await archiveGroup(group.id);

    assert.equal(groupReads, 0);
    assert.equal(local.data['tabg:g:1'], undefined);
    assert.equal(Object.keys(local.data).some(key => key.startsWith('tabg:a:')), false);
  });
}

test('非空组在缓存 miss 时仍读取组对象并写入快照', async () => {
  const local = createStorage();
  globalThis.chrome = {
    storage: { local },
    tabs: { async query() { return [{ id: 2, groupId: 1, url: 'https://example.com/', title: '新' }]; } },
    tabGroups: { async get() { return group; } },
  };
  forgetGroupObject(group.id);

  await backupGroup(group.id);

  assert.equal(local.data['tabg:g:1'].title, group.title);
  assert.deepEqual(local.data['tabg:g:1'].tabs, [{ url: 'https://example.com/', title: '新' }]);
});

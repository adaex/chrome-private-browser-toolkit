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
  let groupReads = 0;
  globalThis.chrome = {
    storage: { local },
    tabs: { async query() { return [{ id: 2, groupId: 1, url: 'https://example.com/', title: '新' }]; } },
    tabGroups: {
      async get() {
        groupReads++;
        return group;
      },
    },
  };
  forgetGroupObject(group.id);

  await backupGroup(group.id);
  await backupGroup(group.id);

  assert.equal(local.data['tabg:g:1'].title, group.title);
  assert.deepEqual(local.data['tabg:g:1'].tabs, [{ url: 'https://example.com/', title: '新' }]);
  assert.equal(groupReads, 1);
});

test('普通空组快照不会抢在组删除归档前清掉 active', async () => {
  const local = createStorage({ 'tabg:g:1': snapshot });
  globalThis.chrome = {
    storage: { local },
    tabs: { async query() { return []; } },
  };

  await backupGroup(group.id, true);
  await archiveGroup(group.id);

  assert.equal(local.data['tabg:g:1'], undefined);
  assert.equal(Object.keys(local.data).filter(key => key.startsWith('tabg:a:')).length, 1);
});

test('同一组同一毫秒重复归档也不会互相覆盖', async () => {
  const local = createStorage({ 'tabg:g:1': snapshot });
  globalThis.chrome = { storage: { local } };
  const originalNow = Date.now;
  Date.now = () => 1770000000000;
  try {
    await archiveGroup(group.id);
    local.data['tabg:g:1'] = { ...snapshot, title: '第二次' };
    await archiveGroup(group.id);
  } finally {
    Date.now = originalNow;
  }

  const archives = Object.entries(local.data).filter(([key]) => key.startsWith('tabg:a:'));
  assert.equal(archives.length, 2);
  assert.deepEqual(new Set(archives.map(([, value]) => value.title)), new Set(['工作', '第二次']));
});

test('init 对账死组时摘掉旧组对象，复用 id 的新组不会读到旧名称', async () => {
  const local = createStorage({ 'tabg:g:1': snapshot });
  globalThis.chrome = {
    storage: { local },
    tabGroups: { async query() { return []; } },
  };
  noteGroupObject(group);

  await initBackupAllGroups([], true);

  const newGroup = { ...group, title: '新组' };
  globalThis.chrome = {
    storage: { local },
    tabs: { async query() { return [{ id: 2, groupId: 1, url: 'https://new.example/', title: '新' }]; } },
    tabGroups: { async get() { return newGroup; } },
  };
  await backupGroup(group.id);
  assert.equal(local.data['tabg:g:1'].title, '新组');
  forgetGroupObject(group.id);
});

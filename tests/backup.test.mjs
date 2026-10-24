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
  test(`空组保留最后快照供归档，缓存状态不影响结果（cached=${cached}）`, async () => {
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
    assert.deepEqual(local.data['tabg:g:1'], snapshot);
    await archiveGroup(group.id);

    assert.equal(groupReads, 0);
    assert.equal(local.data['tabg:g:1'], undefined);
    const archives = Object.keys(local.data).filter(key => key.startsWith('tabg:a:1:'));
    assert.equal(archives.length, 1);
    assert.deepEqual(local.data[archives[0]].tabs, snapshot.tabs);
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

test('init 查询窗口内变空的组仍保留 active 供随后归档', async () => {
  const local = createStorage({ 'tabg:g:1': snapshot });
  globalThis.chrome = {
    storage: { local },
    tabGroups: { async query() { return [group]; } },
  };

  await initBackupAllGroups([], true);
  assert.deepEqual(local.data['tabg:g:1'], snapshot);
  await archiveGroup(group.id);

  const archives = Object.keys(local.data).filter(key => key.startsWith('tabg:a:1:'));
  assert.equal(archives.length, 1);
});

test('缓存回填不覆盖组对象查询期间到达的新状态', async () => {
  const local = createStorage();
  let resolveGet;
  let markGetStarted;
  const getStarted = new Promise(resolve => { markGetStarted = resolve; });
  globalThis.chrome = {
    storage: { local },
    tabs: { async query() { return [{ id: 2, groupId: 1, url: 'https://example.com/', title: '标签' }]; } },
    tabGroups: {
      get() {
        markGetStarted();
        return new Promise(resolve => { resolveGet = resolve; });
      },
    },
  };
  forgetGroupObject(group.id);

  const pending = backupGroup(group.id);
  await getStarted;
  noteGroupObject({ ...group, title: '新组名' });
  resolveGet({ ...group, title: '旧组名' });
  await pending;

  assert.equal(local.data['tabg:g:1'].title, '新组名');
});

test('v1 单 key 数据成功迁移，存活与历史快照按 v2 归档', async () => {
  const deletedAt = '2026-01-02T00:00:00.000Z';
  const legacy = {
    version: 1,
    active: { 1: snapshot },
    archived: [{ ...snapshot, id: 2, deletedAt }],
  };
  const local = createStorage({ tabGroupBackup: legacy });
  globalThis.chrome = {
    storage: { local },
    tabGroups: { async query() { return []; } },
  };

  await initBackupAllGroups([], true);

  assert.equal(local.data.tabGroupBackup, undefined);
  assert.equal(local.data['tabg:g:1'], undefined);
  const activeArchives = Object.keys(local.data).filter(key => key.startsWith('tabg:a:1:'));
  const oldArchives = Object.keys(local.data).filter(key => key.startsWith('tabg:a:2:'));
  assert.equal(activeArchives.length, 1);
  assert.equal(oldArchives.length, 1);
  assert.equal(local.data[oldArchives[0]].deletedAt, deletedAt);
});

test('v1 迁移时存活空组也保留 active 供随后归档', async () => {
  const legacy = { version: 1, active: { 1: snapshot }, archived: [] };
  const local = createStorage({ tabGroupBackup: legacy });
  globalThis.chrome = {
    storage: { local },
    tabGroups: { async query() { return [group]; } },
  };

  await initBackupAllGroups([], true);

  assert.equal(local.data.tabGroupBackup, undefined);
  assert.deepEqual(local.data['tabg:g:1'], snapshot);
  await archiveGroup(group.id);
  const archives = Object.keys(local.data).filter(key => key.startsWith('tabg:a:1:'));
  assert.equal(archives.length, 1);
  assert.deepEqual(local.data[archives[0]].tabs, snapshot.tabs);
});

test('v1 迁移写失败时保留旧单 key', async () => {
  const legacy = { version: 1, active: { 1: snapshot }, archived: [] };
  const local = createStorage({ tabGroupBackup: legacy }, { failSet: () => true });
  globalThis.chrome = {
    storage: { local },
    tabGroups: { async query() { return []; } },
  };

  await assert.rejects(initBackupAllGroups([], true));
  assert.deepEqual(local.data.tabGroupBackup, legacy);
  assert.equal(local.removals.length, 0);
});

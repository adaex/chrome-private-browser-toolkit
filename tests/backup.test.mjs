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
  assert.deepEqual(local.writes, [['tabg:g:1']]);
});

test('单组备份只写变化内容，归档后重建同内容组仍会落盘', async () => {
  const testGroup = { ...group, id: 9 };
  let tab = { id: 90, groupId: 9, url: 'https://example.com/', title: '一' };
  const local = createStorage();
  globalThis.chrome = {
    storage: { local },
    tabs: { async query() { return [tab]; } },
    tabGroups: { async get() { return testGroup; } },
  };
  forgetGroupObject(testGroup.id);

  await backupGroup(testGroup.id);
  await backupGroup(testGroup.id);
  assert.deepEqual(local.writes, [['tabg:g:9']]);

  tab = { ...tab, title: '二' };
  await backupGroup(testGroup.id);
  await backupGroup(testGroup.id);
  assert.deepEqual(local.writes, [['tabg:g:9'], ['tabg:g:9']]);
  assert.equal(local.data['tabg:g:9'].tabs[0].title, '二');

  await archiveGroup(testGroup.id);
  await backupGroup(testGroup.id);
  assert.equal(local.data['tabg:g:9'].tabs[0].title, '二');
  assert.equal(local.writes.filter(keys => keys.includes('tabg:g:9')).length, 3);
});

test('init 部分写入后失败会使内容缓存失效，后续备份不会误跳过', async () => {
  const testGroup = { ...group, id: 10 };
  let tab = { id: 100, groupId: 10, url: 'https://example.com/', title: '旧内容' };
  let failMeta = false;
  const local = createStorage({}, {
    failSet: values => failMeta && Object.keys(values).includes('tabg:meta'),
  });
  globalThis.chrome = {
    storage: { local },
    tabs: { async query() { return [tab]; } },
    tabGroups: {
      async get() { return testGroup; },
      async query() { return [testGroup]; },
    },
  };
  forgetGroupObject(testGroup.id);
  await backupGroup(testGroup.id);

  tab = { ...tab, title: '新内容' };
  failMeta = true;
  await assert.rejects(initBackupAllGroups([tab], true));
  assert.equal(local.data['tabg:g:10'].tabs[0].title, '新内容');

  failMeta = false;
  tab = { ...tab, title: '旧内容' };
  await backupGroup(testGroup.id);
  assert.equal(local.data['tabg:g:10'].tabs[0].title, '旧内容');
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

for (const hasGetKeys of [true, false]) {
  test(`init 只写内容变化的存活组（getKeys=${hasGetKeys}）`, async () => {
    const changedBefore = { ...snapshot, id: 2, title: '旧组名' };
    const local = createStorage({
      'tabg:meta': { lastInitAt: 0 },
      'tabg:g:1': snapshot,
      'tabg:g:2': changedBefore,
    });
    if (!hasGetKeys) local.getKeys = undefined;
    const changedGroup = { ...group, id: 2, title: '新组名' };
    globalThis.chrome = {
      storage: { local },
      tabGroups: { async query() { return [group, changedGroup]; } },
    };
    const tabs = [1, 2].map(groupId => ({
      id: groupId + 10,
      groupId,
      url: 'https://example.com/',
      title: 'Example',
    }));

    await initBackupAllGroups(tabs, true);

    assert.deepEqual(local.writes, [['tabg:g:2'], ['tabg:meta']]);
    assert.deepEqual(local.data['tabg:g:1'], snapshot);
    assert.equal(local.data['tabg:g:2'].title, '新组名');
    assert.notEqual(local.data['tabg:g:2'].updatedAt, changedBefore.updatedAt);

    globalThis.chrome.tabs = {
      async query({ groupId }) { return tabs.filter(tab => tab.groupId === groupId); },
    };
    await backupGroup(group.id);
    assert.deepEqual(local.writes, [['tabg:g:2'], ['tabg:meta']]);
  });

  test(`init 会写回含畸形标签或无效时间的 active（getKeys=${hasGetKeys}）`, async () => {
    const local = createStorage({
      'tabg:g:1': {
        ...snapshot,
        tabs: [snapshot.tabs[0], { url: 42, title: null }],
      },
      'tabg:g:2': { ...snapshot, id: 2, updatedAt: 'invalid-date' },
    });
    if (!hasGetKeys) local.getKeys = undefined;
    const secondGroup = { ...group, id: 2 };
    globalThis.chrome = {
      storage: { local },
      tabGroups: { async query() { return [group, secondGroup]; } },
    };
    const tabs = [1, 2].map(groupId => ({
      id: groupId + 10,
      groupId,
      url: 'https://example.com/',
      title: 'Example',
    }));

    await initBackupAllGroups(tabs, true);

    assert.deepEqual(local.data['tabg:g:1'].tabs, snapshot.tabs);
    assert.ok(Number.isFinite(Date.parse(local.data['tabg:g:2'].updatedAt)));
    assert.deepEqual(local.writes, [['tabg:g:1', 'tabg:g:2'], ['tabg:meta']]);
  });

  test(`残留 v1 不覆盖较新的有效 v2（getKeys=${hasGetKeys}）`, async () => {
    const v2Dead = { ...snapshot, title: 'v2 死组', updatedAt: '2026-03-01T00:00:00.000Z' };
    const v2Live = { ...snapshot, id: 2, title: 'v2 活组', updatedAt: '2026-03-01T00:00:00.000Z' };
    const legacy = {
      version: 1,
      active: {
        1: { ...snapshot, title: 'v1 旧死组' },
        2: { ...snapshot, id: 2, title: 'v1 旧活组' },
      },
      archived: [],
    };
    const local = createStorage({
      tabGroupBackup: legacy,
      'tabg:g:1': v2Dead,
      'tabg:g:2': v2Live,
    });
    if (!hasGetKeys) local.getKeys = undefined;
    globalThis.chrome = {
      storage: { local },
      tabGroups: { async query() { return [{ ...group, id: 2, title: 'v2 活组' }]; } },
    };

    await initBackupAllGroups([], true);

    assert.equal(local.data.tabGroupBackup, undefined);
    assert.equal(local.data['tabg:g:1'], undefined);
    assert.deepEqual(local.data['tabg:g:2'], v2Live);
    const archives = Object.entries(local.data).filter(([key]) => key.startsWith('tabg:a:1:'));
    assert.equal(archives.length, 1);
    assert.equal(archives[0][1].title, 'v2 死组');
    assert.ok(!local.writes.flat().includes('tabg:g:2'));
  });
}

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

test('v1 归档迁移保留 Unix 纪元删除时间', async () => {
  const deletedAt = '1970-01-01T00:00:00.000Z';
  const legacy = {
    version: 1,
    active: {},
    archived: [{ ...snapshot, id: 3, deletedAt }],
  };
  const local = createStorage({ tabGroupBackup: legacy });
  globalThis.chrome = {
    storage: { local },
    tabGroups: { async query() { return []; } },
  };

  await initBackupAllGroups([], true);

  const archives = Object.keys(local.data).filter(key => key.startsWith('tabg:a:3:0:'));
  assert.equal(archives.length, 1);
  assert.equal(local.data[archives[0]].deletedAt, deletedAt);
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

test('v1 迁移时内容变化的存活组仍写入当前拍照时间', async () => {
  const legacy = { version: 1, active: { 1: snapshot }, archived: [] };
  const local = createStorage({
    tabGroupBackup: legacy,
    'tabg:g:1': { ...snapshot, title: '旧组名', updatedAt: '2026-02-01T00:00:00.000Z' },
  });
  globalThis.chrome = {
    storage: { local },
    tabGroups: { async query() { return [group]; } },
  };
  const tabs = [{ id: 2, groupId: 1, url: 'https://example.com/', title: 'Example' }];

  await initBackupAllGroups(tabs, true);

  assert.equal(local.data.tabGroupBackup, undefined);
  assert.equal(local.data['tabg:g:1'].title, snapshot.title);
  assert.notEqual(local.data['tabg:g:1'].updatedAt, snapshot.updatedAt);
  assert.notEqual(local.data['tabg:g:1'].updatedAt, '2026-02-01T00:00:00.000Z');
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

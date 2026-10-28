import assert from 'node:assert/strict';
import test from 'node:test';

import { checkDuplicate, toFullscreenWindow } from '../dist/worker/tabs.js';

const candidates = {
  sameGroup: { id: 1, groupId: 1, windowId: 1, pinned: false },
  merge: { id: 2, groupId: -1, windowId: 1, pinned: false },
  cross: { id: 3, groupId: -1, windowId: 2, pinned: false },
  pinned: { id: 4, groupId: -1, windowId: 1, pinned: true },
  otherGroup: { id: 5, groupId: 2, windowId: 1, pinned: false },
};
const duplicateCases = [
  {
    name: '同组候选优先于同窗并入和跨窗候选',
    duplicates: [candidates.cross, candidates.merge, candidates.sameGroup],
    expectedCalls: [['activate', 1], ['remove', 999]],
  },
  {
    name: '同窗可并入候选优先于跨窗候选',
    duplicates: [candidates.cross, candidates.merge],
    expectedCalls: [['group', 2], ['activate', 2], ['remove', 999]],
  },
  {
    name: '跨窗可激活候选优先于 pinned 和别组候选',
    duplicates: [candidates.pinned, candidates.otherGroup, candidates.cross],
    expectedCalls: [['focus', 2], ['activate', 3], ['remove', 999]],
  },
];

for (const { name, duplicates, expectedCalls } of duplicateCases) {
  test(name, async () => {
    const calls = [];
    const newTab = { id: 999, groupId: 1, windowId: 1, pinned: false };
    globalThis.chrome = {
      tabs: {
        async query() {
          const url = 'https://example.com/';
          return [newTab, ...duplicates].map(tab => ({ ...tab, url }));
        },
        async group({ tabIds }) { calls.push(['group', tabIds]); },
        async update(id) { calls.push(['activate', id]); },
        async remove(id) { calls.push(['remove', id]); },
      },
      windows: { async update(id) { calls.push(['focus', id]); } },
    };

    assert.equal(await checkDuplicate(newTab.id), true);
    assert.deepEqual(calls, expectedCalls);
  });
}

test('扩展代理切换页不参与重复标签合并', async () => {
  const url = 'chrome-extension://test-extension/switch.html?mode=direct';
  const oldTab = { id: 1, url, groupId: -1, windowId: 1, pinned: false };
  const newTab = { ...oldTab, id: 2 };
  const calls = [];
  globalThis.chrome = {
    runtime: { getURL: path => `chrome-extension://test-extension/${path}` },
    tabs: {
      async query() { return [oldTab, newTab]; },
      async update(id) { calls.push(['activate', id]); },
      async remove(id) { calls.push(['remove', id]); },
    },
  };

  assert.equal(await checkDuplicate(newTab.id), false);
  assert.deepEqual(calls, []);
});

test('从同网址 opener 打开时保留重复标签', async () => {
  const oldTab = { id: 1, url: 'https://example.com/', groupId: -1, windowId: 1, pinned: false };
  const newTab = { ...oldTab, id: 2, openerTabId: oldTab.id };
  globalThis.chrome = {
    tabs: { async query() { return [oldTab, newTab]; } },
  };

  assert.equal(await checkDuplicate(newTab.id), false);
});

test('旧标签激活失败时保留当前标签并抛出错误', async () => {
  const removed = [];
  const oldTab = {
    id: 1,
    url: 'https://example.com/',
    groupId: -1,
    windowId: 1,
    pinned: false,
  };
  const newTab = { ...oldTab, id: 2, windowId: 2 };
  globalThis.chrome = {
    tabs: {
      async query() { return [oldTab, newTab]; },
      async update() { throw new Error('模拟激活失败'); },
      async remove(id) { removed.push(id); },
    },
    windows: { async update() {} },
  };

  await assert.rejects(checkDuplicate(newTab.id));
  assert.deepEqual(removed, []);
});

const normalWindow = { id: 1, type: 'normal', state: 'normal' };
const fullscreenWindow = { id: 2, type: 'normal', state: 'fullscreen' };

const fullscreenCases = [
  {
    name: '没有全屏窗口时不读取源窗口标签',
    windows: [normalWindow],
    expectedWindowReads: 0,
  },
  {
    name: '多标签普通窗口中的首位标签不会被吸入全屏窗口',
    sourceTabs: [{ id: 1 }, { id: 2 }],
    expectedWindowReads: 1,
  },
  {
    name: '多个全屏窗口时不选择任意目标或读取源窗口标签',
    windows: [normalWindow, fullscreenWindow, { ...fullscreenWindow, id: 3 }],
    expectedWindowReads: 0,
  },
  {
    name: '全屏吸附前发现 URL 晚到的代理切换页时保留原窗口',
    sourceTabs: [{ id: 2, pendingUrl: 'chrome-extension://test-extension/switch.html?mode=direct' }],
    expectedWindowReads: 1,
  },
  {
    name: '唯一全屏窗口吸附时先移动和激活，再聚焦',
    expectedCalls: ['move', 'activate', 'focus'],
    expectedWindowReads: 1,
  },
];

for (const {
  name,
  windows = [normalWindow, fullscreenWindow],
  sourceTabs = [{ id: 2 }],
  expectedCalls = [],
  expectedWindowReads,
} of fullscreenCases) {
  test(name, async () => {
    const calls = [];
    let windowReads = 0;
    globalThis.chrome = {
      runtime: { getURL: path => `chrome-extension://test-extension/${path}` },
      windows: {
        async getAll() { return windows; },
        async get() {
          windowReads++;
          return { ...normalWindow, tabs: sourceTabs };
        },
        async update() { calls.push('focus'); },
      },
      tabs: {
        async move() { calls.push('move'); },
        async update() { calls.push('activate'); },
      },
    };

    await toFullscreenWindow(2, normalWindow.id);
    assert.deepEqual(calls, expectedCalls);
    assert.equal(windowReads, expectedWindowReads);
  });
}

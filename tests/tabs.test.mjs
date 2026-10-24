import assert from 'node:assert/strict';
import test from 'node:test';

import { checkDuplicate, toFullscreenWindow } from '../dist/worker/tabs.js';

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

test('多标签普通窗口中的首位标签不会被吸入全屏窗口', async () => {
  const calls = [];
  globalThis.chrome = {
    windows: {
      async getAll() { return [normalWindow, fullscreenWindow]; },
      async get() { return { ...normalWindow, tabs: [{ id: 1 }, { id: 2 }] }; },
      async update() { calls.push('focus'); },
    },
    tabs: {
      async move() { calls.push('move'); },
      async update() { calls.push('activate'); },
    },
  };

  await toFullscreenWindow(2, normalWindow.id);
  assert.deepEqual(calls, []);
});

test('单标签窗口吸附时先移动和激活，再聚焦全屏窗口', async () => {
  const calls = [];
  globalThis.chrome = {
    windows: {
      async getAll() { return [normalWindow, fullscreenWindow]; },
      async get() { return { ...normalWindow, tabs: [{ id: 2 }] }; },
      async update() { calls.push('focus'); },
    },
    tabs: {
      async move() { calls.push('move'); },
      async update() { calls.push('activate'); },
    },
  };

  await toFullscreenWindow(2, normalWindow.id);
  assert.deepEqual(calls, ['move', 'activate', 'focus']);
});

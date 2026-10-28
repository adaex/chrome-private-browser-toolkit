import assert from 'node:assert/strict';
import test from 'node:test';

import { PROXY_MESSAGE } from '../dist/worker/proxy.js';
import { createEventRegistry, createProxyIndicatorMock, createStorage, flush } from './helpers.mjs';

test('外部代理消息在普通后台串行执行，最后一条指令决定最终模式', async () => {
  const { event } = createEventRegistry();
  const local = createStorage({ 'tabg:meta': { lastInitAt: Date.now() } });
  const sets = [];
  let value = { mode: 'direct' };
  let onMessage;
  globalThis.chrome = {
    ...createProxyIndicatorMock(),
    runtime: {
      onMessage: {
        addListener(listener) { onMessage = listener; },
      },
    },
    proxy: {
      settings: {
        onChange: { addListener() {} },
        async get() {
          return { value: structuredClone(value), levelOfControl: 'controlled_by_this_extension' };
        },
        async set(details) {
          sets.push(structuredClone(details));
          value = structuredClone(details.value);
        },
      },
    },
    tabs: {
      async query() { return []; },
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

  function send(operation, mode) {
    return new Promise(resolve => {
      assert.equal(onMessage({ type: PROXY_MESSAGE, operation, mode }, {}, resolve), true);
    });
  }
  const responses = await Promise.all([
    send('applyExternal', 'socks5'),
    send('setMode', 'direct'),
  ]);

  assert.deepEqual(responses, [
    { ok: true, applied: true },
    { ok: true },
  ]);
  assert.deepEqual(sets, [
    {
      value: {
        mode: 'fixed_servers',
        rules: { singleProxy: { scheme: 'socks5', host: '127.0.0.1', port: 7890 } },
      },
      scope: 'regular',
    },
    { value: { mode: 'direct' }, scope: 'regular' },
  ]);
});

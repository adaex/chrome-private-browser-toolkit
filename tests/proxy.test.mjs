import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PROXY_PORT,
  loadProxyPort,
  readProxyStatus,
  saveProxyPort,
  setProxyMode,
  syncProxyIndicator,
} from '../dist/worker/proxy.js';
import { createStorage } from './helpers.mjs';

const localSocks = port => ({
  mode: 'fixed_servers',
  rules: {
    singleProxy: { scheme: 'socks5', host: '127.0.0.1', port },
  },
});

function installChrome({ value = { mode: 'direct' }, levelOfControl = 'controlled_by_this_extension', initial = {} } = {}) {
  const local = createStorage(initial);
  const sets = [];
  let readCount = 0;
  const icons = [];
  const titles = [];
  globalThis.chrome = {
    storage: { local },
    proxy: {
      settings: {
        async get() {
          readCount++;
          return { value: structuredClone(value), levelOfControl };
        },
        async set(details) {
          sets.push(structuredClone(details));
          value = structuredClone(details.value);
        },
      },
    },
    action: {
      async setIcon(details) { icons.push(details); },
      async setTitle(details) { titles.push(details); },
    },
  };
  return { local, sets, readCount: () => readCount, icons, titles };
}

test('默认使用本机 SOCKS5 7890，直连通过显式 direct 设置', async () => {
  const { sets } = installChrome();

  await setProxyMode('socks5');
  await setProxyMode('direct');

  assert.deepEqual(sets, [
    { value: localSocks(DEFAULT_PROXY_PORT), scope: 'regular' },
    { value: { mode: 'direct' }, scope: 'regular' },
  ]);
});

test('代理状态读取 Chrome 实际配置和外部控制状态', async () => {
  installChrome({
    value: localSocks(1080),
    levelOfControl: 'controlled_by_other_extensions',
    initial: { proxyPort: 7890 },
  });

  assert.deepEqual(await readProxyStatus(), {
    mode: 'socks5',
    port: 1080,
    controlledByOther: true,
  });
});

test('直连、本机代理和其他模式使用不同状态图标', async () => {
  const { icons, titles } = installChrome();

  await syncProxyIndicator();
  await setProxyMode('socks5');
  await syncProxyIndicator();
  const { icons: otherIcons, titles: otherTitles } = installChrome({ value: { mode: 'system' } });
  await syncProxyIndicator();

  assert.equal(icons[0].path[16], 'icon/icon_16.png');
  assert.equal(icons[1].path[16], 'icon/socks5_16.png');
  assert.match(titles[1].title, /127\.0\.0\.1:7890/);
  assert.equal(otherIcons[0].path[16], 'icon/other_16.png');
  assert.match(otherTitles[0].title, /其他代理模式/);
});

test('端口保存后立即用于本机代理，直连时不修改代理设置', async () => {
  const { local, sets } = installChrome();

  await saveProxyPort(1080);
  assert.equal(sets.length, 0);
  await setProxyMode('socks5');
  await saveProxyPort(2080);

  assert.equal(sets[0].value.rules.singleProxy.port, 1080);
  assert.equal(sets[1].value.rules.singleProxy.port, 2080);
  assert.equal(local.data.proxyPort, 2080);
  assert.equal(await loadProxyPort(), 2080);
});

test('其他扩展控制代理时仍可保存端口，但不抢控制权', async () => {
  const { local, sets } = installChrome({
    value: localSocks(7890),
    levelOfControl: 'controlled_by_other_extensions',
  });

  await saveProxyPort(9000);

  assert.equal(sets.length, 0);
  assert.equal(local.data.proxyPort, 9000);
});

test('无痕上下文不读写代理设置或保存端口', async () => {
  const { local, sets, readCount } = installChrome();
  chrome.extension = { inIncognitoContext: true };

  await assert.rejects(setProxyMode('direct'));
  await assert.rejects(setProxyMode('socks5'));
  await assert.rejects(saveProxyPort(9000));

  assert.equal(readCount(), 0);
  assert.equal(sets.length, 0);
  assert.equal(local.writes.length, 0);
});

test('非法端口在读写代理或存储前被拒绝', async () => {
  const { local, sets } = installChrome();

  for (const port of [0, -1, 1.5, 65536, Number.NaN]) {
    await assert.rejects(saveProxyPort(port));
  }

  assert.equal(sets.length, 0);
  assert.equal(local.writes.length, 0);
});

test('工具栏同步不读取弹窗使用的预配置端口', async () => {
  const { local } = installChrome();
  const originalGet = local.get;
  let portReads = 0;
  local.get = (...args) => {
    portReads++;
    return originalGet(...args);
  };

  await syncProxyIndicator();
  assert.equal(portReads, 0);
  await readProxyStatus();
  assert.equal(portReads, 1);
});

test('慢返回的旧代理状态不会覆盖最新工具栏图标', async () => {
  const { icons } = installChrome();
  let resolveFirst;
  let reads = 0;
  chrome.proxy.settings.get = () => {
    reads++;
    if (reads === 1) {
      return new Promise(resolve => {
        resolveFirst = () => resolve({
          value: { mode: 'direct' },
          levelOfControl: 'controlled_by_this_extension',
        });
      });
    }
    return Promise.resolve({
      value: localSocks(DEFAULT_PROXY_PORT),
      levelOfControl: 'controlled_by_this_extension',
    });
  };

  const staleSync = syncProxyIndicator();
  await syncProxyIndicator();
  resolveFirst();
  await staleSync;

  assert.equal(reads, 2);
  assert.equal(icons.length, 1);
  assert.equal(icons[0].path[16], 'icon/socks5_16.png');
});

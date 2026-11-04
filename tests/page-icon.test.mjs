import assert from 'node:assert/strict';
import test from 'node:test';

import { startProxyStatusIconSync } from '../dist/ui.js';
import { flush } from './helpers.mjs';

function createImage() {
  let source = 'icon/icon.svg';
  let assignments = 0;
  return {
    get src() { return source; },
    set src(value) {
      source = value;
      assignments++;
    },
    getAttribute(name) {
      return name === 'src' ? source : null;
    },
    get assignments() { return assignments; },
  };
}

function proxyResult(value) {
  return { value: structuredClone(value), levelOfControl: 'controlled_by_this_extension' };
}

test('页面品牌图随实际代理模式切换，相同模式不重复设置图片', async () => {
  let value = { mode: 'direct' };
  let listener;
  globalThis.chrome = {
    extension: { inIncognitoContext: false },
    proxy: {
      settings: {
        onChange: { addListener(callback) { listener = callback; } },
        async get() { return proxyResult(value); },
      },
    },
  };
  const image = createImage();
  startProxyStatusIconSync(image);
  await flush();
  assert.equal(image.src, 'icon/icon.svg');
  assert.equal(image.assignments, 0);

  value = {
    mode: 'fixed_servers',
    rules: { singleProxy: { scheme: 'socks5', host: '127.0.0.1', port: 7890 } },
  };
  listener(proxyResult(value));
  assert.equal(image.src, 'icon/socks5.svg');
  assert.equal(image.assignments, 1);

  listener(proxyResult(value));
  assert.equal(image.assignments, 1);

  value = { mode: 'system' };
  listener(proxyResult(value));
  assert.equal(image.src, 'icon/icon.svg');
  assert.equal(image.assignments, 2);
});

test('慢返回的启动状态不会覆盖事件带来的页面新图标', async () => {
  const pending = [];
  let listener;
  globalThis.chrome = {
    extension: { inIncognitoContext: false },
    proxy: {
      settings: {
        onChange: { addListener(callback) { listener = callback; } },
        get() {
          return new Promise(resolve => pending.push(resolve));
        },
      },
    },
  };
  const image = createImage();
  startProxyStatusIconSync(image);
  assert.equal(pending.length, 1);

  listener(proxyResult({
    mode: 'fixed_servers',
    rules: { singleProxy: { scheme: 'socks5', host: '127.0.0.1', port: 7890 } },
  }));
  assert.equal(image.src, 'icon/socks5.svg');

  pending[0](proxyResult({ mode: 'direct' }));
  await flush();
  assert.equal(image.src, 'icon/socks5.svg');
});

test('无痕页面不读取或监听代理状态', async () => {
  let reads = 0;
  let listeners = 0;
  globalThis.chrome = {
    extension: { inIncognitoContext: true },
    proxy: {
      settings: {
        onChange: { addListener() { listeners++; } },
        async get() {
          reads++;
          return proxyResult({ mode: 'direct' });
        },
      },
    },
  };
  const image = createImage();
  startProxyStatusIconSync(image);
  await flush();

  assert.equal(reads, 0);
  assert.equal(listeners, 0);
  assert.equal(image.src, 'icon/icon.svg');
});

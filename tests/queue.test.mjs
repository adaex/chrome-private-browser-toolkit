import assert from 'node:assert/strict';
import test from 'node:test';

import { Queue } from '../dist/worker/queue.js';
import { flush } from './helpers.mjs';

test('任务积压时保持并发上限和入队顺序，排空后仍可复用', async () => {
  const queue = new Queue(2);
  const started = [];
  let active = 0;
  let maxActive = 0;

  for (let i = 0; i < 200; i++) {
    queue.run(async () => {
      started.push(i);
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
    });
  }
  await flush();

  assert.deepEqual(started, Array.from({ length: 200 }, (_, i) => i));
  assert.equal(maxActive, 2);

  let ranAfterDrain = false;
  queue.run(async () => { ranAfterDrain = true; });
  await flush();
  assert.equal(ranAfterDrain, true);
});

test('任务同步抛错会记录并释放并发名额，后续任务继续执行', async () => {
  const queue = new Queue(1);
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    queue.run(() => { throw new Error('模拟同步失败'); });
    let continued = false;
    queue.run(async () => { continued = true; });
    await flush();
    assert.equal(continued, true);
    assert.equal(errors.length, 1);
  } finally {
    console.error = originalError;
  }
});

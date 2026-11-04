import assert from 'node:assert/strict';
import test from 'node:test';

import { readBackupDetails, readBackupSummary } from '../dist/worker/backup.js';

const keys = [
  'featureSettings',
  'tabg:meta',
  'tabg:g:1',
  'tabg:g:2',
  'tabg:a:3:100:abc',
  'tabGroupBackup',
];

test('支持 getKeys 时只按键名统计，不读取任何备份值', async () => {
  let valueReads = 0;
  globalThis.chrome = {
    storage: {
      local: {
        async getKeys() { return keys; },
        async get() {
          valueReads++;
          throw new Error('不应读取备份值');
        },
      },
    },
  };

  assert.deepEqual(await readBackupSummary(), {
    activeCount: 2,
    archivedCount: 1,
    hasLegacyBackup: true,
  });
  assert.equal(valueReads, 0);
});

test('完整读取只选取存活、归档和旧版数据，并同时完成统计', async () => {
  globalThis.chrome = {
    storage: {
      local: {
        async get(request) {
          assert.equal(request, null);
          return {
            featureSettings: { deduplicate: true },
            'tabg:meta': { lastInitAt: 100 },
            'tabg:g:1': { id: 1 },
            'tabg:a:3:100:abc': { id: 3 },
            tabGroupBackup: { active: {} },
          };
        },
      },
    },
  };

  const { entries, summary } = await readBackupDetails();
  assert.deepEqual(entries, {
    'tabg:g:1': { id: 1 },
    'tabg:a:3:100:abc': { id: 3 },
    tabGroupBackup: { active: {} },
  });
  assert.deepEqual(summary, {
    activeCount: 1,
    archivedCount: 1,
    hasLegacyBackup: true,
  });
});

test('老版本没有 getKeys 时回退全量读取键名', async () => {
  globalThis.chrome = {
    storage: {
      local: {
        async get(request) {
          assert.equal(request, null);
          return { 'tabg:g:1': { id: 1 }, featureSettings: {} };
        },
      },
    },
  };

  assert.deepEqual(await readBackupSummary(), {
    activeCount: 1,
    archivedCount: 0,
    hasLegacyBackup: false,
  });
});

export function createStorage(initial = {}, { failSet = () => false } = {}) {
  const data = structuredClone(initial);
  const writes = [];
  const removals = [];
  return {
    data,
    writes,
    removals,
    async getKeys() {
      return Object.keys(data);
    },
    async get(keys) {
      const list = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
      return structuredClone(
        Object.fromEntries(list.filter(key => key in data).map(key => [key, data[key]])),
      );
    },
    async set(values) {
      writes.push(Object.keys(values));
      if (failSet(values)) throw new Error('模拟存储写入失败');
      Object.assign(data, structuredClone(values));
    },
    async remove(keys) {
      const list = typeof keys === 'string' ? [keys] : keys;
      removals.push(list);
      for (const key of list) delete data[key];
    },
  };
}

export function createEventRegistry() {
  const listeners = {};
  return {
    listeners,
    event(name) {
      return {
        addListener(listener) {
          listeners[name] = listener;
        },
      };
    },
  };
}

export function createProxyIndicatorMock() {
  return {
    action: {
      async setIcon() {},
      async setTitle() {},
    },
    proxy: {
      settings: {
        onChange: { addListener() {} },
        async get() {
          return {
            value: { mode: 'direct' },
            levelOfControl: 'controlled_by_this_extension',
          };
        },
      },
    },
  };
}

export function flush() {
  return new Promise(resolve => setImmediate(resolve));
}

export const group = {
  id: 1,
  title: '工作',
  color: 'blue',
  collapsed: false,
  windowId: 1,
};

export const snapshot = {
  id: 1,
  title: '工作',
  color: 'blue',
  tabs: [{ url: 'https://example.com/', title: 'Example' }],
  updatedAt: '2026-01-01T00:00:00.000Z',
};

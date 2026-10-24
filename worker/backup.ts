import { noteGroupObject, resolveGroupObject } from './groupCache.js';
import { effectiveUrl } from './tabs.js';

// 类型定义
type TabGroup = chrome.tabGroups.TabGroup;

interface TabSnapshot {
  url: string;
  title: string;
}

interface GroupSnapshot {
  id: number;
  title: string;
  color: string;
  tabs: TabSnapshot[];
  updatedAt: string;
  deletedAt?: string;
}

// v2 存储布局：拆 key，单次备份只写一个小组快照，不再全量重写
//   tabg:meta                     -> { lastInitAt }
//   tabg:g:<groupId>              -> 存活组的快照，每组一个 key；键集合本身就是存活组真相
//   tabg:a:<groupId>:<删除毫秒时间戳> -> 已删除组的归档，只增不删，恢复靠人工读 JSON
const META_KEY = 'tabg:meta';
export const ACTIVE_PREFIX = 'tabg:g:';
export const ARCHIVE_PREFIX = 'tabg:a:';
export const LEGACY_KEY = 'tabGroupBackup'; // v1 的单 key，首次 init 时一次性迁移
const INIT_THROTTLE_MS = 5 * 60 * 1000; // SW 频繁重启，全量 init 5 分钟最多一次

const activeKey = (groupId: number) => `${ACTIVE_PREFIX}${groupId}`;
const archiveKey = (groupId: number, deletedAtMs: number) =>
  `${ARCHIVE_PREFIX}${groupId}:${deletedAtMs}`;

async function readLastInitAt(): Promise<number> {
  const result = await chrome.storage.local.get(META_KEY);
  const meta = result[META_KEY];
  return meta && typeof meta === 'object' && typeof (meta as { lastInitAt?: unknown }).lastInitAt === 'number'
    ? (meta as { lastInitAt: number }).lastInitAt
    : 0;
}

// 读出的数据不信任形状，归一失败就当不存在，避免一份畸形数据让所有备份永久抛错
function sanitizeSnapshot(value: unknown): GroupSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== 'number' ||
    typeof v.title !== 'string' ||
    typeof v.color !== 'string' ||
    typeof v.updatedAt !== 'string' ||
    !Array.isArray(v.tabs)
  ) {
    return null;
  }

  const tabs: TabSnapshot[] = [];
  for (const item of v.tabs) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    if (typeof t.url === 'string' && typeof t.title === 'string') {
      tabs.push({ url: t.url, title: t.title });
    }
  }

  const snapshot: GroupSnapshot = {
    id: v.id,
    title: v.title,
    color: v.color,
    tabs,
    updatedAt: v.updatedAt,
  };
  if (typeof v.deletedAt === 'string') snapshot.deletedAt = v.deletedAt;
  return snapshot;
}

// 归档条目：归档 key 与 deletedAt 盖戳的约定只此一处
function archiveEntry(snapshot: GroupSnapshot, deletedAtMs: number): [string, GroupSnapshot] {
  return [
    archiveKey(snapshot.id, deletedAtMs),
    { ...snapshot, deletedAt: new Date(deletedAtMs).toISOString() },
  ];
}

// 把某个标签组的当前状态拍成快照
function snapshotGroup(group: TabGroup, tabs: chrome.tabs.Tab[], updatedAt: string): GroupSnapshot {
  return {
    id: group.id,
    title: group.title ?? '',
    color: group.color,
    tabs: tabs
      .map(tab => ({ url: effectiveUrl(tab), title: tab.title ?? '' }))
      .filter(tab => tab.url),
    updatedAt,
  };
}

// 备份单个标签组：只写这一个组的 key，不读不写其他数据
export async function backupGroup(groupId: number) {
  // 先查标签：组已删除时统一按空组处理，缓存命中与否不再改变归档结果
  const tabs = await chrome.tabs.query({ groupId });
  if (!tabs.length) {
    await chrome.storage.local.remove(activeKey(groupId));
    return;
  }

  const group = resolveGroupObject(groupId) ?? (await chrome.tabGroups.get(groupId));
  await chrome.storage.local.set({
    [activeKey(groupId)]: snapshotGroup(group, tabs, new Date().toISOString()),
  });
}

// 归档已删除的标签组：active key 移为归档 key（打 deletedAt），不丢弃；无快照则无需动作
export async function archiveGroup(groupId: number) {
  const key = activeKey(groupId);
  const result = await chrome.storage.local.get(key);
  const snapshot = sanitizeSnapshot(result[key]);
  if (!snapshot) return;

  const [archiveK, archiveV] = archiveEntry(snapshot, Date.now());
  await chrome.storage.local.set({ [archiveK]: archiveV });
  await chrome.storage.local.remove(key);
}

// 启动时全量对账：刷新存活组、把存储中已不存在的组移入归档、顺带迁移 v1 数据。
// allTabs 由调用方先查好（重建归属缓存要用），组内在 JS 里按 groupId 聚合，不再每组一次 query。
// force=true 表示唤醒后有归属事件抢跑，无视节流、以最新标签状态强刷一次
export async function initBackupAllGroups(allTabs: chrome.tabs.Tab[], force = false) {
  if (!force && Date.now() - (await readLastInitAt()) < INIT_THROTTLE_MS) return;

  const storage = chrome.storage.local;
  // Chrome 130+ 可只枚举键名：归档字节完全不读；老版本回退全量读取
  const hasGetKeys = typeof storage.getKeys === 'function';

  // 实时存活组、存储侧键集合、v1 旧数据三件互不依赖的事并行
  const [groups, keysOrRecord, legacyWrap] = await Promise.all([
    chrome.tabGroups.query({}),
    hasGetKeys ? storage.getKeys() : storage.get(null),
    hasGetKeys ? storage.get(LEGACY_KEY) : Promise.resolve(null),
  ]);

  const fullRecord = hasGetKeys ? null : (keysOrRecord as Record<string, unknown>);
  const storedKeys = hasGetKeys ? (keysOrRecord as string[]) : Object.keys(fullRecord!);
  const legacy = hasGetKeys
    ? (legacyWrap as Record<string, unknown> | null)?.[LEGACY_KEY]
    : fullRecord![LEGACY_KEY];

  const liveIds = new Set(groups.map(group => group.id));

  // prior：存储侧 active 快照（死组归档要用），只 sanitize 一次
  const prior = new Map<number, GroupSnapshot>();
  const storedActiveIds = new Set<number>();
  for (const key of storedKeys) {
    if (!key.startsWith(ACTIVE_PREFIX)) continue;
    const id = Number(key.slice(ACTIVE_PREFIX.length));
    storedActiveIds.add(id);
    if (fullRecord) {
      const snapshot = sanitizeSnapshot(fullRecord[key]);
      if (snapshot) prior.set(id, snapshot);
    }
  }

  const toSet: Record<string, unknown> = {};
  const toRemove: string[] = [];

  // v1 迁移：旧的单 key 对象拆进 v2 布局，随本次 init 落盘后删除旧 key
  if (legacy && typeof legacy === 'object') {
    const v1 = legacy as Record<string, unknown>;
    const legacyActive =
      v1.active && typeof v1.active === 'object'
        ? (v1.active as Record<string, unknown>)
        : {};
    for (const value of Object.values(legacyActive)) {
      const snapshot = sanitizeSnapshot(value);
      if (!snapshot) continue;
      storedActiveIds.add(snapshot.id);
      prior.set(snapshot.id, snapshot);
    }
    if (Array.isArray(v1.archived)) {
      for (const item of v1.archived) {
        const snapshot = sanitizeSnapshot(item);
        if (!snapshot) continue;
        const deletedAtMs = snapshot.deletedAt
          ? Date.parse(snapshot.deletedAt) || Date.now()
          : Date.now();
        const [key, value] = archiveEntry(snapshot, deletedAtMs);
        toSet[key] = value;
      }
    }
    toRemove.push(LEGACY_KEY);
  }

  // 死组 = 存储有 active 键但实时已不存在（SW 没在运行时漏掉的 onRemoved）。
  // getKeys 路径刚才只读了键名，这里定向取死组值；全量路径 prior 已有
  const deadIds = [...storedActiveIds].filter(id => !liveIds.has(id));
  if (hasGetKeys && deadIds.length) {
    const deadRecord = await storage.get(deadIds.map(activeKey));
    for (const id of deadIds) {
      const snapshot = sanitizeSnapshot(deadRecord[activeKey(id)]);
      if (snapshot) prior.set(id, snapshot);
    }
  }
  for (const id of deadIds) {
    const snapshot = prior.get(id);
    if (snapshot) {
      const [key, value] = archiveEntry(snapshot, Date.now());
      toSet[key] = value;
    }
    toRemove.push(activeKey(id)); // 移入归档，绝不硬删；畸形无值也至少摘掉键
  }

  const tabsByGroup = new Map<number, chrome.tabs.Tab[]>();
  for (const tab of allTabs) {
    if (tab.groupId > 0) {
      const list = tabsByGroup.get(tab.groupId);
      if (list) list.push(tab);
      else tabsByGroup.set(tab.groupId, [tab]);
    }
  }

  const now = new Date().toISOString();
  for (const group of groups) {
    noteGroupObject(group); // 顺手预热组对象缓存
    const tabs = tabsByGroup.get(group.id);
    // 与 backupGroup 同一 upsert 语义：存活但为空（正常会被 Chrome 立即删组）不保留旧键
    if (!tabs || !tabs.length) {
      toRemove.push(activeKey(group.id));
      continue;
    }
    toSet[activeKey(group.id)] = snapshotGroup(group, tabs, now);
  }

  // 先写后删：归档或迁移写入失败时保留旧数据，删除失败至多下次产生重复归档
  if (Object.keys(toSet).length) await storage.set(toSet);
  if (toRemove.length) await storage.remove(toRemove);
  // meta 最后写：它的时间戳代表本次对账真正完成
  await storage.set({ [META_KEY]: { lastInitAt: Date.now() } });
}

import { noteGroupObject, resolveGroupObject, syncGroupObjects } from './groupCache.js';
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
//   tabg:a:<groupId>:<删除毫秒时间戳>:<随机ID> -> 已删除组的归档，只增不删，恢复靠人工读 JSON
const META_KEY = 'tabg:meta';
export const ACTIVE_PREFIX = 'tabg:g:';
export const ARCHIVE_PREFIX = 'tabg:a:';
export const LEGACY_KEY = 'tabGroupBackup'; // v1 的单 key，首次 init 时一次性迁移
const INIT_THROTTLE_MS = 5 * 60 * 1000; // SW 频繁重启，全量 init 5 分钟最多一次

const activeKey = (groupId: number) => `${ACTIVE_PREFIX}${groupId}`;
const archiveKey = (groupId: number, deletedAtMs: number) =>
  `${ARCHIVE_PREFIX}${groupId}:${deletedAtMs}:${crypto.randomUUID()}`;

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

// sanitize 后的内容相同还不够：原始 active 含多余字段、畸形标签或无效时间时仍需借 init 写回清洗
function isCanonicalSnapshot(value: unknown, snapshot: GroupSnapshot): boolean {
  const v = value as Record<string, unknown>;
  const expectedKeys = Object.keys(snapshot);
  if (
    Object.keys(v).length !== expectedKeys.length ||
    !expectedKeys.every(key => key in v) ||
    !Number.isFinite(Date.parse(snapshot.updatedAt))
  ) {
    return false;
  }

  const rawTabs = v.tabs as unknown[];
  if (rawTabs.length !== snapshot.tabs.length) return false;
  for (let i = 0; i < rawTabs.length; i++) {
    const rawTab = rawTabs[i] as Record<string, unknown>;
    const cleanTab = snapshot.tabs[i];
    if (Object.keys(rawTab).length !== 2 || rawTab.url !== cleanTab.url || rawTab.title !== cleanTab.title) {
      return false;
    }
  }
  return true;
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

// updatedAt 只记录拍照时间；内容没变时无需为了刷新时间戳再写一次存储
function sameSnapshotContent(a: GroupSnapshot, b: GroupSnapshot): boolean {
  if (
    a.id !== b.id ||
    a.title !== b.title ||
    a.color !== b.color ||
    a.deletedAt !== b.deletedAt ||
    a.tabs.length !== b.tabs.length
  ) {
    return false;
  }
  for (let i = 0; i < a.tabs.length; i++) {
    if (a.tabs[i].url !== b.tabs[i].url || a.tabs[i].title !== b.tabs[i].title) return false;
  }
  return true;
}

// 与 sameSnapshotContent 同口径，但不保留完整快照；每组只常驻 64 个十六进制字符
async function snapshotFingerprint(snapshot: GroupSnapshot): Promise<string> {
  const content = JSON.stringify([
    snapshot.id,
    snapshot.title,
    snapshot.color,
    snapshot.deletedAt,
    snapshot.tabs.map(tab => [tab.url, tab.title]),
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// 当前 SW 内已确认与存储一致的 active 指纹；complete/title 重复事件无需再写相同快照
// 不为此增加存储读取；SW 重启后缓存自然清空，首次备份仍保守写入
const activeSnapshotCache = new Map<number, string>();

// 备份单个标签组：只写这一个组的 key，不读不写其他数据
export async function backupGroup(groupId: number) {
  const tabs = await chrome.tabs.query({ groupId });
  // 空组保留最后 active，供 onRemoved 或下次 init 统一归档
  if (!tabs.length) return;

  let group = resolveGroupObject(groupId);
  if (!group) {
    const fetched = await chrome.tabGroups.get(groupId);
    // get 期间若来了 onUpdated，保留事件刚写入的新对象
    group = resolveGroupObject(groupId) ?? fetched;
    noteGroupObject(group);
  }
  const next = snapshotGroup(group, tabs, new Date().toISOString());
  const fingerprint = await snapshotFingerprint(next);
  if (activeSnapshotCache.get(groupId) === fingerprint) return;

  await chrome.storage.local.set({ [activeKey(groupId)]: next });
  // 只有确认落盘后才更新缓存；写失败时后续事件仍会重试
  activeSnapshotCache.set(groupId, fingerprint);
}

// 归档已删除的标签组：active key 移为归档 key（打 deletedAt），不丢弃；无快照则无需动作
export async function archiveGroup(groupId: number) {
  // 归档可能改变或移除 active；先失效，失败时也只是后续备份多写一次
  activeSnapshotCache.delete(groupId);
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

  // 对账可能分批写 active、删旧 key；任一步失败都只损失缓存命中，后续备份会保守重写
  activeSnapshotCache.clear();

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

  // prior：存储侧 active 快照，死组归档与存活组内容比较共用，只 sanitize 一次
  const prior = new Map<number, GroupSnapshot>();
  const storedActiveIds = new Set<number>();
  const canonicalActiveIds = new Set<number>();
  for (const key of storedKeys) {
    if (!key.startsWith(ACTIVE_PREFIX)) continue;
    const id = Number(key.slice(ACTIVE_PREFIX.length));
    storedActiveIds.add(id);
    if (fullRecord) {
      const snapshot = sanitizeSnapshot(fullRecord[key]);
      if (snapshot) {
        prior.set(id, snapshot);
        if (isCanonicalSnapshot(fullRecord[key], snapshot)) canonicalActiveIds.add(id);
      }
    }
  }

  // getKeys 路径一次读回 active 值，仍不读取任何归档字节
  if (hasGetKeys && storedActiveIds.size) {
    const activeRecord = await storage.get([...storedActiveIds].map(activeKey));
    for (const id of storedActiveIds) {
      const snapshot = sanitizeSnapshot(activeRecord[activeKey(id)]);
      if (snapshot) {
        prior.set(id, snapshot);
        if (isCanonicalSnapshot(activeRecord[activeKey(id)], snapshot)) canonicalActiveIds.add(id);
      }
    }
  }

  const toSet: Record<string, unknown> = {};
  const toRemove: string[] = [];
  const currentFingerprints = new Map<number, string>();

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
      // 上次迁移可能已写入更新的 v2；legacy 只补齐没有有效 v2 的 active
      if (!prior.has(snapshot.id)) {
        prior.set(snapshot.id, snapshot);
        toSet[activeKey(snapshot.id)] = snapshot;
      }
    }
    if (Array.isArray(v1.archived)) {
      for (const item of v1.archived) {
        const snapshot = sanitizeSnapshot(item);
        if (!snapshot) continue;
        const parsedDeletedAt = Date.parse(snapshot.deletedAt ?? '');
        const deletedAtMs = Number.isNaN(parsedDeletedAt) ? Date.now() : parsedDeletedAt;
        const [key, value] = archiveEntry(snapshot, deletedAtMs);
        toSet[key] = value;
      }
    }
    toRemove.push(LEGACY_KEY);
  }

  // 死组 = 存储有 active 键但实时已不存在（SW 没在运行时漏掉的 onRemoved）。
  const deadIds = [...storedActiveIds].filter(id => !liveIds.has(id));
  for (const id of deadIds) {
    const snapshot = prior.get(id);
    if (snapshot) {
      const [key, value] = archiveEntry(snapshot, Date.now());
      toSet[key] = value;
    }
    toRemove.push(activeKey(id)); // 有效快照先归档；畸形或无值只能移除 active，避免卡住后续对账
  }

  const tabsByGroup = new Map<number, chrome.tabs.Tab[]>();
  for (const tab of allTabs) {
    if (tab.groupId > 0) {
      const list = tabsByGroup.get(tab.groupId);
      if (list) list.push(tab);
      else tabsByGroup.set(tab.groupId, [tab]);
    }
  }

  syncGroupObjects(groups);

  const now = new Date().toISOString();
  for (const group of groups) {
    const tabs = tabsByGroup.get(group.id);
    // 查询间隙组可能正在删除：空组不写新快照，也不删 active，交给 onRemoved 或下次 init 归档
    if (!tabs || !tabs.length) continue;
    const next = snapshotGroup(group, tabs, now);
    const key = activeKey(group.id);
    const previous = prior.get(group.id);
    // 全量对账只落盘新增、非规范或内容变化的组；规范且未变的快照保留原 updatedAt
    // v1 迁移已排的 active 写入仍换成最新快照，不让旧时间戳覆盖现有 v2 数据
    if (key in toSet || !previous || !canonicalActiveIds.has(group.id) || !sameSnapshotContent(previous, next)) {
      toSet[key] = next;
    }
    currentFingerprints.set(group.id, await snapshotFingerprint(next));
  }

  // 先写后删：归档或迁移写入失败时保留旧数据，删除失败至多下次产生重复归档
  if (Object.keys(toSet).length) await storage.set(toSet);
  if (toRemove.length) await storage.remove(toRemove);
  // meta 最后写：它的时间戳代表本次对账真正完成
  await storage.set({ [META_KEY]: { lastInitAt: Date.now() } });
  for (const [id, fingerprint] of currentFingerprints) activeSnapshotCache.set(id, fingerprint);
}

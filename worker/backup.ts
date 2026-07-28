import { catchError } from './queue.js';

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

interface BackupData {
  version: number;
  active: Record<number, GroupSnapshot>;
  archived: GroupSnapshot[];
}

// 常量
const STORAGE_KEY = 'tabGroupBackup';
const ARCHIVE_LIMIT = 200; // 归档最多保留最近 200 条，超出丢弃最旧

const emptyBackup = (): BackupData => ({ version: 1, active: {}, archived: [] });

// 读取备份数据（storage 缺失时返回空结构）
async function readBackup(): Promise<BackupData> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const data = result[STORAGE_KEY] as BackupData | undefined;
  if (!data) return emptyBackup();
  return {
    version: data.version ?? 1,
    active: data.active ?? {},
    archived: data.archived ?? [],
  };
}

// 写回备份数据
async function writeBackup(data: BackupData) {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

// 把某个标签组的当前状态拍成快照
function snapshotGroup(group: TabGroup, tabs: chrome.tabs.Tab[], updatedAt: string): GroupSnapshot {
  return {
    id: group.id,
    title: group.title ?? '',
    color: group.color,
    tabs: tabs
      .map(tab => ({ url: tab.pendingUrl ?? tab.url ?? '', title: tab.title ?? '' }))
      .filter(tab => tab.url),
    updatedAt,
  };
}

// 备份单个标签组：写入 active[groupId]
export async function backupGroup(groupOrId: TabGroup | number) {
  const group = typeof groupOrId === 'object' ? groupOrId : await chrome.tabGroups.get(groupOrId);
  if (!group) return;

  const tabs = await chrome.tabs.query({ groupId: group.id });
  if (!tabs.length) return;

  const data = await readBackup();
  data.active[group.id] = snapshotGroup(group, tabs, new Date().toISOString());
  await writeBackup(data);
}

// 归档已删除的标签组：把 active[groupId] 移入 archived（打 deletedAt）
export async function archiveGroup(groupId: number) {
  const data = await readBackup();
  const snapshot = data.active[groupId];
  if (!snapshot) return; // 没有备份过，无从归档

  delete data.active[groupId];
  data.archived.push({ ...snapshot, deletedAt: new Date().toISOString() });

  // 控制归档体积，超出上限丢弃最旧
  if (data.archived.length > ARCHIVE_LIMIT) {
    data.archived = data.archived.slice(-ARCHIVE_LIMIT);
  }

  await writeBackup(data);
}

// 启动时全量刷新 active 快照（archived 保持不动）
export async function initBackupAllGroups() {
  const groups = await chrome.tabGroups.query({});
  const data = await readBackup();
  const now = new Date().toISOString();

  for (const group of groups) {
    const tabs = await chrome.tabs.query({ groupId: group.id }).catch(catchError('tabs.query'));
    if (!tabs || !tabs.length) continue;
    data.active[group.id] = snapshotGroup(group, tabs, now);
  }

  await writeBackup(data);
}

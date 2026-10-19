// tabId -> groupId：onRemoved/onDetached 事件不带归属、标签死后也查不到，必须事前记住
const tabGroupCache = new Map<number, number>();

// SW 唤醒后、启动重建完成前发生的归属事件拿不到旧归属，记一笔让启动 init 强刷兜底
let coldMiss = false;

export function rebuildGroupCache(allTabs: chrome.tabs.Tab[]) {
  tabGroupCache.clear();
  for (const tab of allTabs) {
    if (typeof tab.id === 'number') tabGroupCache.set(tab.id, tab.groupId);
  }
}

export function noteGroup(tabId: number, groupId: number) {
  tabGroupCache.set(tabId, groupId);
}

export function forgetTab(tabId: number) {
  tabGroupCache.delete(tabId);
}

// 取事件前记下的组归属。缓存存全部标签（含未分组的 -1），
// 所以 miss 只可能发生在启动重建完成前，此时标记 coldMiss
export function formerGroupOf(tabId: number): number | undefined {
  const groupId = tabGroupCache.get(tabId);
  if (groupId === undefined) coldMiss = true;
  return groupId;
}

// 启动任务读取一次：唤醒后是否有归属事件抢跑，需要强刷
export function consumeColdMiss(): boolean {
  const missed = coldMiss;
  coldMiss = false;
  return missed;
}

// 组对象缓存：热路径 backupGroup(number) 省一次 tabGroups.get。
// 陈旧只影响快照的 title/color（标签始终实时 query），任何组 onUpdated 或下次 init 会刷新
const groupObjectCache = new Map<number, chrome.tabGroups.TabGroup>();

export function noteGroupObject(group: chrome.tabGroups.TabGroup) {
  groupObjectCache.set(group.id, group);
}

export function forgetGroupObject(groupId: number) {
  groupObjectCache.delete(groupId);
}

export function resolveGroupObject(groupId: number) {
  return groupObjectCache.get(groupId);
}

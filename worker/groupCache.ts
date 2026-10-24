// tabId -> groupId：onRemoved/onDetached 事件不带归属、标签死后也查不到，必须事前记住
const tabGroupCache = new Map<number, number>();

// 只在重建查询窗口内记录事件归属，避免旧快照覆盖新状态；查询结束即清空
const changedTabs = new Set<number>();
let rebuilding = false;

// SW 唤醒后、启动重建完成前发生的归属事件拿不到旧归属，记一笔让启动 init 强刷兜底
let coldMiss = false;

// 查询与重建共用一条成功路径；失败由调用方的队列边界接管，finally 不留下记录状态
export async function rebuildGroupCache(): Promise<chrome.tabs.Tab[]> {
  rebuilding = true;
  try {
    const allTabs = await chrome.tabs.query({});
    for (const tabId of tabGroupCache.keys()) {
      if (!changedTabs.has(tabId)) tabGroupCache.delete(tabId);
    }
    for (const tab of allTabs) {
      if (typeof tab.id === 'number' && !changedTabs.has(tab.id)) {
        tabGroupCache.set(tab.id, tab.groupId);
      }
    }
    return allTabs;
  } finally {
    changedTabs.clear();
    rebuilding = false;
  }
}

export function noteGroup(tabId: number, groupId: number) {
  if (rebuilding) changedTabs.add(tabId);
  tabGroupCache.set(tabId, groupId);
}

export function forgetTab(tabId: number) {
  if (rebuilding) changedTabs.add(tabId);
  tabGroupCache.delete(tabId);
}

// 取事件前记下的组归属。未知标签记一笔 coldMiss，让启动 init 强刷兜底
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
// 只用于读取组名和颜色，不参与空组判断；任何组 onUpdated 或下次 init 会刷新
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

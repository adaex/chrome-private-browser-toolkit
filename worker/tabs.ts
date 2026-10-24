// 标签当前有效网址：加载中是 pendingUrl，加载完是 url。去重比对与备份拍照必须同一口径
export const effectiveUrl = (tab: chrome.tabs.Tab): string => tab.pendingUrl ?? tab.url ?? '';

// 监听 tab 的创建和更新事件，检查是否有重复的 tab
// 返回 true 表示新标签已被关闭（重复命中），调用方不要再操作这个标签
export async function checkDuplicate(tabId: number): Promise<boolean> {
  // 获取所有的 tabs，调用浏览器 api
  const tabs = await chrome.tabs.query({});

  // 获取当前 tab 和 url
  const tab = tabs.find(item => item.id === tabId);
  const url = tab ? effectiveUrl(tab) : '';

  // 异常不存在，直接忽略
  if (!tab?.id) return false;

  // 获取全部同 URL 的已存在标签（可能不止一个，不能吃 query 的数组顺序，要按优先级挑目标）
  // 新标签自身还没有 URL 时不去重（否则两个空 URL 标签会互相匹配）
  const duplicates = url
    ? tabs.filter(other => other.id !== tabId && effectiveUrl(other) === url)
    : [];

  // 目标不存在，直接忽略
  if (!duplicates.length) return false;

  // 选定本次要激活/并入的老标签（duplicates 非空，reduce 必返回其中元素）
  const existedTab = pickTarget(duplicates, tab);
  if (!existedTab.id) return false;

  // 特殊情况：打开新标签页，直接关闭历史标签页，新标签保留（不查 pinned，有意）
  if (url.startsWith('chrome://new')) {
    await chrome.tabs.remove(existedTab.id);
    return false;
  }

  // 特殊情况：复制 tab 的场景（自己打开自己），允许重复，本次操作忽略
  if (tab.openerTabId != null && duplicates.some(other => other.id === tab.openerTabId)) return false;

  // 新的在组里的特殊处理
  if (tab.groupId > 0 && existedTab.groupId !== tab.groupId) {
    if (existedTab.pinned) return false; // 新的 tab 在组里，老的 tab 是固定的，不处理
    if (existedTab.groupId > 0) return false; // 新的 tab 在组里，老的 tab 在组里，不处理
    // 新的 tab 在组里，老的 tab 不在组里，同窗时把老的 tab 移进新组；跨窗不成组（组不能跨窗口）
    if (existedTab.windowId === tab.windowId) {
      await chrome.tabs.group({ tabIds: existedTab.id, groupId: tab.groupId });
    }
  }

  // 如果不在一个窗口，需要把老的 tab 所在的窗口激活
  if (existedTab.windowId !== tab.windowId)
    await chrome.windows.update(existedTab.windowId, { focused: true });

  // 激活失败会抛给队列并中止，不能继续关掉用户正在打开的标签
  await chrome.tabs.update(existedTab.id, { active: true });
  await chrome.tabs.remove(tab.id); // 必须要等 active 完成之后再 remove，否则会 active 会乱跳
  return true;
}

// 候选处理优先级（数值越小越优先）。等级与上面的特判分支是同一套规则：
// SAME    同组 / 同窗：直接激活，或同窗可并入新组
// CROSS   跨窗未分组：可聚焦另一窗口激活
// SKIP    pinned / 在别组：特判分支会保留重复，必须垫底，否则会挡住跨窗可用目标
const PREFERENCE = {
  SAME: 0,
  MERGE: 1,
  CROSS: 2,
  SKIP: 3,
} as const;

function pickTarget(duplicates: chrome.tabs.Tab[], tab: chrome.tabs.Tab): chrome.tabs.Tab {
  const rank = (other: chrome.tabs.Tab): number => {
    if (tab.groupId > 0) {
      if (other.groupId === tab.groupId) return PREFERENCE.SAME;
      if (other.groupId < 0 && !other.pinned) {
        return other.windowId === tab.windowId ? PREFERENCE.MERGE : PREFERENCE.CROSS;
      }
      return PREFERENCE.SKIP;
    }
    return other.windowId === tab.windowId ? PREFERENCE.SAME : PREFERENCE.CROSS;
  };
  return duplicates.reduce((best, current) => (rank(current) < rank(best) ? current : best));
}

// 如果有全屏的窗口，则把当前 tab 移动到全屏的窗口里去
export async function toFullscreenWindow(tabId: number, windowId: number) {
  const [windows, currentWindow] = await Promise.all([
    chrome.windows.getAll(),
    chrome.windows.get(windowId, { populate: true }),
  ]);
  const fullscreenWindow = windows.find(window => window.state === 'fullscreen' && window.type === 'normal');

  // index === 0 不等于新窗口；源窗口必须仍只有当前这一个标签，避免拆散已有多标签窗口
  if (
    fullscreenWindow?.id &&
    currentWindow.type === 'normal' &&
    currentWindow.state === 'normal' &&
    currentWindow.tabs?.length === 1 &&
    currentWindow.tabs[0].id === tabId
  ) {
    await chrome.tabs.move(tabId, { windowId: fullscreenWindow.id, index: -1 });
    await chrome.tabs.update(tabId, { active: true });
    // 先移动再聚焦，移动失败时不把用户焦点抢到另一个窗口
    await chrome.windows.update(fullscreenWindow.id, { focused: true });
  }
}

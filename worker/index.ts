import { archiveGroup, backupGroup, initBackupAllGroups } from './backup.js';
import {
  consumeColdMiss,
  forgetGroupObject,
  forgetTab,
  formerGroupOf,
  noteGroup,
  noteGroupObject,
  rebuildGroupCache,
} from './groupCache.js';
import { catchError, queue } from './queue.js';
import { checkDuplicate, toFullscreenWindow } from './tabs.js';

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});

// SW 唤醒后第一个事件可能与启动重建赛跑：查询在顶层立即发起，尽量抢在事件回调读缓存之前完成
const initialTabsQuery = chrome.tabs.query({});
initialTabsQuery.then(rebuildGroupCache).catch(catchError('initialTabsQuery'));

chrome.tabs.onCreated.addListener(tab => {
  const tabId = tab.id;
  if (!tabId) return;
  noteGroup(tabId, tab.groupId);

  queue.run(async () => {
    // 先去重：命中重复时新标签会被关掉，全屏吸附就不必再做，也避免焦点在两个窗口间来回跳
    const removed = await checkDuplicate(tabId);

    // 从外部打开一个全新普通的窗口，且新标签还在，才把这个 tab 移到全屏窗口
    if (!removed && !tab.openerTabId && tab.index === 0) {
      await toFullscreenWindow(tabId, tab.windowId);
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const prevGroupId = formerGroupOf(tabId);
  noteGroup(tabId, tab.groupId);

  if (changeInfo.url) {
    queue.run(() => checkDuplicate(tabId));
  }

  // 同一事件可能同时满足多个备份条件（如 groupId 变化且 status=complete），每组本次只入队一次
  const scheduled = new Set<number>();
  const scheduleBackup = (groupId: number | undefined) => {
    if (groupId && groupId > 0 && !scheduled.has(groupId)) {
      scheduled.add(groupId);
      queue.run(() => backupGroup(groupId));
    }
  };

  // complete 时一定有了 title；complete 之后标题再变（SPA 改 document.title 等）也要追上
  if (changeInfo.status === 'complete' || (changeInfo.title && tab.status === 'complete')) {
    scheduleBackup(tab.groupId);
  }

  // 入组、离组、跨组移动：新组要拍，旧组少了标签也要拍（独立分支，不与上面互斥）
  if (changeInfo.groupId != null) {
    if (prevGroupId && prevGroupId > 0 && prevGroupId !== tab.groupId) scheduleBackup(prevGroupId);
    scheduleBackup(tab.groupId);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const groupId = formerGroupOf(tabId);
  forgetTab(tabId);

  // 整窗关闭时组本身也会被删，tabGroups.onRemoved 会归档整组，这里不用再拍
  if (!removeInfo.isWindowClosing && groupId && groupId > 0) {
    queue.run(() => backupGroup(groupId));
  }
});

chrome.tabs.onDetached.addListener(tabId => {
  // 跨窗口拖出：标签会被自动移出原组，onDetached 本身不带 groupId，用缓存定位旧组
  const groupId = formerGroupOf(tabId);
  if (groupId && groupId > 0) queue.run(() => backupGroup(groupId));
});

chrome.tabGroups.onUpdated.addListener(group => {
  // 一般是修改名称和颜色、折叠等；无标题是新建组的常态，不当拦截条件
  noteGroupObject(group);
  queue.run(() => backupGroup(group));
});

chrome.tabGroups.onRemoved.addListener(group => {
  // 组被删除时归档快照，误删可从归档找回
  forgetGroupObject(group.id);
  queue.run(() => archiveGroup(group.id));
});

queue.run(async () => {
  // 先等启动查询（其 then 已重建缓存）；此期间事件回调已经跑过，cold miss 标志能反映真实情况。
  // 标志为真说明归属事件抢在缓存就绪前、初始查询也可能捕捉的是变化前状态：重新查最新状态并无视节流
  const initialTabs = await initialTabsQuery.catch(() => [] as chrome.tabs.Tab[]);
  if (consumeColdMiss()) {
    const latestTabs = await chrome.tabs.query({});
    rebuildGroupCache(latestTabs);
    await initBackupAllGroups(latestTabs, true);
  } else {
    await initBackupAllGroups(initialTabs, false);
  }
});

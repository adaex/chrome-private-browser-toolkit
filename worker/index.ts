import { archiveGroup, backupGroup, initBackupAllGroups } from './backup.js';
import {
  consumeColdMiss,
  forgetGroupObject,
  forgetTab,
  formerGroupOf,
  noteGroup,
  noteGroupObject,
  rebuildGroupCache,
  resolveGroupObject,
} from './groupCache.js';
import { catchError, Queue, queue } from './queue.js';
import { applyProxyWrite, PROXY_MESSAGE, syncProxyIndicator } from './proxy.js';
import { loadFeatureSettings } from './settings.js';
import { checkDuplicate, effectiveUrl, isProxySwitchUrl, toFullscreenWindow } from './tabs.js';

const proxyWriteQueue = new Queue(1);

function startNormalMode() {
  // 同组只保留一个待执行备份；执行期间又来了事件，可再排一个尾随备份读取最新状态
  const pendingGroupBackups = new Set<number>();
  function scheduleBackup(groupId: number | undefined) {
    if (!groupId || groupId <= 0 || pendingGroupBackups.has(groupId)) return;
    pendingGroupBackups.add(groupId);
    queue.run(async () => {
      // 让同一轮同步事件先完成合并，例如 complete 与 groupId 同时变化
      await Promise.resolve();
      pendingGroupBackups.delete(groupId);
      await backupGroup(groupId);
    });
  }

  const refreshProxyIndicator = () => {
    syncProxyIndicator().catch(catchError('proxyIndicator'));
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== PROXY_MESSAGE) return;
    proxyWriteQueue.run(async () => {
      try {
        sendResponse(await applyProxyWrite(message));
      } catch (error) {
        catchError('proxyWrite')(error);
        sendResponse({ ok: false });
      }
    });
    return true;
  });

  chrome.proxy.settings.onChange.addListener(refreshProxyIndicator);
  refreshProxyIndicator();

  // 顶层立即查询并重建；失败由启动队列统一记录并中止，不会当成空标签继续对账
  const initialTabsReady = rebuildGroupCache();

  chrome.tabs.onCreated.addListener(tab => {
    const tabId = tab.id;
    if (!tabId) return;
    noteGroup(tabId, tab.groupId);

    // 一次性代理切换页不参与标签管理，避免失败后的同 URL 重试被合并或移动
    if (isProxySwitchUrl(effectiveUrl(tab))) return;

    queue.run(async () => {
      const settings = await loadFeatureSettings();

      // 先去重：命中重复时新标签会被关掉，全屏吸附就不必再做，也避免焦点在两个窗口间来回跳
      const removed = settings.deduplicate ? await checkDuplicate(tabId) : false;

      // 从外部打开一个全新普通的单标签窗口，且新标签还在，才把这个 tab 移到全屏窗口
      if (!removed && settings.fullscreen && !tab.openerTabId && tab.index === 0) {
        await toFullscreenWindow(tabId, tab.windowId);
      }
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const prevGroupId = formerGroupOf(tabId);
    noteGroup(tabId, tab.groupId);

    if (changeInfo.url && !isProxySwitchUrl(changeInfo.url)) {
      queue.run(async () => {
        if ((await loadFeatureSettings()).deduplicate) await checkDuplicate(tabId);
      });
    }

    // complete 后拍下当前标题；之后 SPA 等场景再改标题时补拍
    if (changeInfo.status === 'complete' || (changeInfo.title != null && tab.status === 'complete')) {
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
    if (!removeInfo.isWindowClosing) scheduleBackup(groupId);
  });

  chrome.tabs.onDetached.addListener(tabId => {
    // 跨窗口拖出：标签会被自动移出原组，onDetached 本身不带 groupId，用缓存定位旧组
    scheduleBackup(formerGroupOf(tabId));
  });

  chrome.tabGroups.onUpdated.addListener(group => {
    const previous = resolveGroupObject(group.id);
    noteGroupObject(group);

    // 快照不保存 collapsed，纯折叠/展开无需重写；缓存 miss 时保守拍一次
    if (!previous || previous.title !== group.title || previous.color !== group.color) {
      scheduleBackup(group.id);
    }
  });

  chrome.tabGroups.onRemoved.addListener(group => {
    // 组被删除时归档快照，误删可从归档找回
    forgetGroupObject(group.id);
    queue.run(() => archiveGroup(group.id));
  });

  queue.run(async () => {
    const initialTabs = await initialTabsReady;

    // 有归属事件在缓存就绪前 miss，说明旧组可能没拍到：查最新状态并无视节流强刷一次
    if (consumeColdMiss()) {
      const latestTabs = await rebuildGroupCache();
      await initBackupAllGroups(latestTabs, true);
    } else {
      await initBackupAllGroups(initialTabs, false);
    }
  });
}

// split 的无痕进程与普通进程共享 storage.local；不注册业务监听，避免操作或备份无痕标签
if (chrome.extension?.inIncognitoContext !== true) startNormalMode();

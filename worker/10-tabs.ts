// 监听 tab 的创建和更新事件，检查是否有重复的 tab
async function checkDuplicate(tabId: number) {
  // 获取所有的 tabs，调用浏览器 api
  const tabs = await chrome.tabs.query({});

  // console.log(new Date().toISOString(), 'checkDuplicate tabs', tabs);

  // 获取当前 tab 和 url
  const tab = tabs.find(tab => tab.id === tabId);
  const url = tab?.pendingUrl || tab?.url || '';

  // 异常不存在，直接忽略
  if (!tab?.id) return;

  // 获取已存在的 tab
  const existedTab = url ? tabs.find(tab => tab.id !== tabId && tab.url === url) : undefined;

  // console.log(new Date().toISOString(), 'checkDuplicate currentTab existedTab', currentTab, existedTab);

  // 目标不存在，直接忽略
  if (!existedTab?.id) return;

  // 特殊情况：打开新标签页，直接关闭历史标签页
  if (url.startsWith('chrome://new')) return await chrome.tabs.remove(existedTab.id).catch(noop);

  // 特殊情况：复制 tab 的场景（自己打开自己），允许重复，本次操作忽略
  if (tab.openerTabId === existedTab.id) return;

  // 特殊情况：Arc 浏览器，外部打开链接，正在加载中，有时候 active 事件会延后，会发现新的 tab 没有 active ，这时候执行 update 没有变化，则此次忽略，由下次 update 的时候再触发生效
  // if (!currentTab.active && existedTab.active) {
  //   if (!currentTab?.openerTabId && !currentTab.url) return;
  // }

  // 特殊情况：Arc 浏览器，关闭之后重新打开，有的标签页无效（非常高、非常窄，unload 状态），解决方案是重启下浏览器
  // if (existedTab.status === 'unloaded' && existedTab.height === 935) return;

  // 特殊情况：Arc 浏览器，如果没有加载，则强制刷新，否则无法跳转，一般是关闭浏览器后重新打开，历史的 tab 会设置为 unloaded 状态（这个逻辑适用于 arc 浏览器）
  // if (existedTab.status === 'unloaded') await chrome.tabs.reload(existedTab.id, { bypassCache: true }).catch(noop);

  // 新的在组里的特殊处理
  if (tab.groupId > 0 && existedTab.groupId !== tab.groupId) {
    if (existedTab.pinned) return; // 新的 tab 在组里，老的 tab 是固定的，不处理
    if (existedTab.groupId > 0) return; // 新的 tab 在组里，老的 tab 在组里，不处理
    if (existedTab.groupId < 0) {
      // 新的 tab 在组里，老的 tab 不在组里，需要把老的 tab 移动到新的 tab 所在的组里
      await chrome.tabs.group({ tabIds: existedTab.id, groupId: tab.groupId }).catch(noop);
      await chrome.tabs.move(existedTab.id, { index: tab.index }).catch(noop);
    }
  }

  // 如果不在一个窗口，需要把老的 tab 所在的窗口激活
  if (existedTab.windowId !== tab.windowId)
    await chrome.windows.update(existedTab.windowId, { focused: true }).catch(noop);

  // 正常激活并删除无用标签
  await chrome.tabs.update(existedTab.id, { active: true }).catch(noop);
  await chrome.tabs.remove(tab.id).catch(noop); // 必须要等 active 完成之后再 remove，否则会 active 会乱跳
}

// 如果有全屏的窗口，则把当前 tab 移动到全屏的窗口里去
async function toFullscreenWindow(tabId: number, windowId: number) {
  const windows = await chrome.windows.getAll();
  const fullscreenWindow = windows.find(window => window.state === 'fullscreen' && window.type === 'normal');
  const currentWindow = windows.findLast(window => window.id === windowId);

  // console.log(new Date().toISOString(), 'toFullscreenWindow windows', windows);

  if (fullscreenWindow?.id && currentWindow?.type === 'normal' && currentWindow.state === 'normal') {
    await chrome.windows.update(fullscreenWindow.id, { focused: true }).catch(noop);
    await chrome.tabs.move(tabId, { windowId: fullscreenWindow.id, index: -1 }).catch(noop);
    await chrome.tabs.update(tabId, { active: true }).catch(noop);
  }
}

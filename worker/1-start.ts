chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});

chrome.tabs.onCreated.addListener(tab => {
  const tabId = tab.id;
  // if (tabId) console.log(new Date().toISOString(), 'onCreated', tab);

  if (tabId) {
    // 从外部打开一个全新普通的窗口，这个时候需要把这个 tab 移动到全屏的窗口里去
    if (!tab.openerTabId && tab.index === 0) {
      queue.run(() => toFullscreenWindow(tabId, tab.windowId));
    }

    queue.run(() => checkDuplicate(tabId));
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // if (changeInfo.url) console.log(new Date().toISOString(), 'onUpdated', changeInfo);

  if (changeInfo.url) {
    queue.run(() => checkDuplicate(tabId));
  }

  if (tab.groupId > -1) {
    // 页面加载完成，这时候一定有了 title
    if (changeInfo.status === 'complete') {
      // console.log(new Date().toISOString() + ' tab complete', changeInfo, tab);
      queue.run(() => updateGroupAndBookmarks(tab.groupId));
    }
    // 已经打开的标签，加入组
    else if (changeInfo.groupId && tab.status === 'complete') {
      // console.log(new Date().toISOString() + ' tab grouped', changeInfo, tab);
      queue.run(() => updateGroupAndBookmarks(tab.groupId));
    }
  }
});

chrome.tabGroups.onRemoved.addListener(group => {
  // console.log(new Date().toISOString() + ' tabGroup onRemoved', group);
  queue.run(async () => folderMapping.delete(group.id));
});

chrome.tabGroups.onUpdated.addListener(group => {
  if (!group.title) return;
  // console.log(new Date().toISOString() + ' tabGroup onUpdated', group);

  // 一般是修改名称和颜色、折叠等
  queue.run(() => updateGroupAndBookmarks(group));
});

queue.run(() => initUpdateAllGroupFolder());

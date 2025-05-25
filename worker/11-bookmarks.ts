// 类型定义
type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;
type TabGroup = chrome.tabGroups.TabGroup;
type Tab = chrome.tabs.Tab;

// 常量定义
const ROOT_FOLDER_NAME = '标签组';
const COLOR_ICON_MAP = {
  grey: '🩶',
  blue: '💙',
  red: '❤️',
  yellow: '💛',
  green: '💚',
  pink: '🩷',
  purple: '💜',
  cyan: '🩵',
  orange: '🧡',
};

// 工具函数
const folderMapping = new Map<number, string>();

// 查找或创建根文件夹
async function _getOrCreateRootFolder(tree: BookmarkNode[]) {
  for (const tree0 of tree[0].children ?? []) {
    for (const tree1 of tree0.children ?? []) {
      if (tree1.title.includes(ROOT_FOLDER_NAME)) return tree1;
    }
  }
  return await chrome.bookmarks.create({ parentId: '1', title: ROOT_FOLDER_NAME });
}

// 查找分组对应的书签文件夹
async function _getAndSyncGroupFolder(tree: BookmarkNode[], group: TabGroup) {
  const rootFolder = await _getOrCreateRootFolder(tree);

  // 使用分组名称作为文件夹名
  const icon = COLOR_ICON_MAP[group.color] ?? '';
  const title = `${icon}${group.title}`;
  const folderId = folderMapping.get(group.id);

  const folder = folderId
    ? rootFolder.children?.find(folder => folder.id === folderId)
    : rootFolder.children?.find(folder => folder.title === title || folder.title === group.title);

  // 如果文件夹不存在，创建它
  if (!folder) {
    const newFolder = await chrome.bookmarks.create({ parentId: rootFolder.id, title });
    folderMapping.set(group.id, newFolder.id);
    return newFolder;
  }

  // 更新映射关系
  if (folderId !== folder.id) {
    folderMapping.set(group.id, folder.id);
  }

  // 更新文件夹名称
  if (folder.title !== title) {
    await chrome.bookmarks.update(folder.id, { title }).catch(noop);
  }

  return folder;
}

// 同步分组的标签到书签文件夹
async function _syncGroupBookmarks(groupFolder: BookmarkNode, tabs: Tab[]) {
  const bookmarkMap = new Map<string, BookmarkNode>();
  const bookmarkIdSet = new Set<string>();

  const bookmarks = groupFolder?.children || [];
  for (const bookmark of bookmarks) {
    if (bookmark.url) bookmarkMap.set(bookmark.url, bookmark);
  }

  // console.log('syncGroupBookmarks', 'bookmarks', bookmarks, 'tabs', tabs);

  // 更新或创建书签
  for (const [index, tab] of tabs.entries()) {
    const url = tab?.pendingUrl ?? tab?.url ?? '';
    if (!url) continue;
    const existingBookmark = bookmarkMap.get(url);
    if (existingBookmark) {
      if (tab.title && existingBookmark.title !== tab.title) {
        await chrome.bookmarks.update(existingBookmark.id, { title: tab.title }).catch(noop);
      }
      if (existingBookmark.index !== index) {
        await chrome.bookmarks.move(existingBookmark.id, { index }).catch(noop);
      }
      bookmarkIdSet.add(existingBookmark.id);
    } else {
      await chrome.bookmarks.create({ parentId: groupFolder.id, title: tab.title || url, url, index }).catch(noop);
    }
  }

  // 清理不再存在的标签对应的书签
  for (const bookmark of bookmarks) {
    if (bookmark.url && !bookmarkIdSet.has(bookmark.id)) {
      await chrome.bookmarks.remove(bookmark.id).catch(noop);
    }
  }
}

// 更新某个分组和对应的书签
async function updateGroupAndBookmarks(groupOrId: TabGroup | number) {
  const group = typeof groupOrId === 'object' ? groupOrId : await chrome.tabGroups.get(groupOrId);
  if (!group) return;
  const tabs = await chrome.tabs.query({ groupId: group.id });
  if (!tabs.length) return;
  const tree = await chrome.bookmarks.getTree();
  const groupFolder = await _getAndSyncGroupFolder(tree, group);
  await _syncGroupBookmarks(groupFolder, tabs);
}

// 更新所有的书签文件夹
async function initUpdateAllGroupFolder() {
  const tree = await chrome.bookmarks.getTree();
  const groups = await chrome.tabGroups.query({});
  for (const group of groups) {
    await _getAndSyncGroupFolder(tree, group);
  }
}

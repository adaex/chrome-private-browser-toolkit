# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 项目概览

这是一个 **Chrome Manifest V3 扩展**，名为 "Private Browser Toolkit"。它通过 Service Worker 在后台监听浏览器事件，提供增强的标签页管理功能。

**权限**: `tabs`, `tabGroups`, `bookmarks`

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `yarn dev` | TypeScript 监听模式编译 (`tsc -w`) |
| `yarn build` | 构建到 dist 目录（clean → copy → tsc） |
| `yarn release` | 构建并打包为 `extension.zip` |

**输出目录**: `dist/` —— Chrome 加载扩展时选择此目录。

---

## 架构与核心模块

所有代码位于 `worker/` 目录，编译为 ES Module 输出到 `dist/worker/`。

### 入口: `worker/index.ts`

注册 Chrome 事件监听器，所有异步操作通过串行队列执行：

| 事件 | 触发行为 |
|------|----------|
| `action.onClicked` | 打开扩展设置页 |
| `tabs.onCreated` | 移动到全屏窗口 + 重复检测 |
| `tabs.onUpdated` | URL 变化时重复检测；标签加载完成且在组内时同步书签 |
| `tabGroups.onRemoved` | 清除内存中的 groupId 映射 |
| `tabGroups.onUpdated` | 组名/颜色变化时同步书签 |
| 启动时 | 调用 `initUpdateAllGroupFolder()` 初始化映射 |

### 队列: `worker/queue.ts`

```typescript
export const queue = new Queue(1);  // 并发数 = 1，确保 Chrome API 串行执行
```

- `Queue` 类：带并发控制的任务队列，每个 task 链上有 `.catch(catchError('queue'))` 兜底
- `catchError(context)`: 返回一个错误处理函数，输出到 console.error

**重要**: 所有 Chrome API 调用都通过 `queue.run()` 序列化执行，避免竞态条件。

### 标签页管理: `worker/tabs.ts`

| 函数 | 作用 |
|------|------|
| `checkDuplicate(tabId)` | 查询全部标签，通过 `pendingUrl \|\| url` 比对检测重复（两边对称）。激活已存在标签，关闭新标签。特殊处理：新标签页(`chrome://new*`)、复制 tab、标签组场景 |
| `toFullscreenWindow(tabId, windowId)` | 如果存在全屏窗口，将新创建的普通窗口的第一个 tab 移动到全屏窗口中 |

### 书签同步: `worker/bookmarks.ts`

**核心机制**: 将 Chrome 标签组自动同步为书签文件夹，根文件夹名为 `"标签组"`。

| 函数 | 作用 |
|------|------|
| `updateGroupAndBookmarks(groupOrId)` | 同步单个标签组 → 书签文件夹（增删改书签以匹配标签组内容） |
| `initUpdateAllGroupFolder()` | 启动时扫描所有标签组，建立 groupId → bookmarkFolderId 映射 |

**状态**:
```typescript
export const FolderMapping = new Map<number, string>();  // groupId → bookmarkFolderId
```

**同步逻辑**:
1. 根文件夹在"书签栏"下查找或创建
2. 标签组颜色通过 emoji 前缀标识（如 `💙我的分组`）
3. `_syncGroupBookmarks()` 通过 URL 匹配：更新存在的、创建新增的、删除不存在的
4. 书签顺序与标签页顺序一致

---

## 关键点

- **无网络请求**: 代码中无 `fetch` / `XMLHttpRequest`，纯本地操作
- **无 content scripts**: 当前版本不注入任何脚本到页面
- **无持久化存储**: 除 Chrome 原生 `bookmarks` API 外，不使用 `chrome.storage`
- **错误处理**: Chrome API 调用点附带 `.catch(catchError('context'))`，队列层额外做 catch 兜底，错误仅输出到控制台

---

## 开发提示

1. 在 `chrome://extensions/` 加载 `dist/` 目录后，点击 Service Worker 的 "Service Worker" 链接可查看 console 日志
2. TypeScript 使用 ESM 导入（`.js` 后缀），如 `import { catchError } from './queue.js';`

---

## 发布更新

1. 修改 `manifest.json` 中的 `version`
2. `yarn release` 生成 `extension.zip`
3. 打开 devconsole 上传页，拖入 zip，提交审核：
   https://chrome.google.com/u/1/webstore/devconsole/27bf1380-10a4-4673-a253-0da100617e74/gnpaolggdcljndfmfealhoefoopkghch/edit/package

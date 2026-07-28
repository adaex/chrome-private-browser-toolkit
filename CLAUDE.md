# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 项目概览

这是一个 **Chrome Manifest V3 扩展**，名为 "Private Browser Toolkit"。它通过 Service Worker 在后台监听浏览器事件，提供增强的标签页管理功能。

**权限**: `tabs`, `tabGroups`, `storage`

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
| `tabs.onUpdated` | URL 变化时重复检测；标签加载完成且在组内时备份该组 |
| `tabGroups.onRemoved` | 归档该组快照（从 active 移入 archived，打 deletedAt） |
| `tabGroups.onUpdated` | 组名/颜色变化时备份该组 |
| 启动时 | 调用 `initBackupAllGroups()` 全量刷新 active 快照 |

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

### 标签组备份: `worker/backup.ts`

**核心机制**: 将 Chrome 标签组自动快照到 `chrome.storage.local`（key = `tabGroupBackup`），出问题时可从中找回。纯数据保存，不做一键恢复，恢复靠人工读 JSON 重开。

| 函数 | 作用 |
|------|------|
| `backupGroup(groupOrId)` | 读该组全部标签，写入 `active[groupId]` |
| `archiveGroup(groupId)` | 组被删除时，把 `active[groupId]` 移入 `archived` 并打 `deletedAt`，从 active 删除 |
| `initBackupAllGroups()` | 启动时全量刷新 `active` 快照（`archived` 不动） |

**数据结构**:
```typescript
interface BackupData {
  version: number;
  active: Record<number, GroupSnapshot>;  // 当前活着的组，按 groupId 覆盖更新
  archived: GroupSnapshot[];              // 已删除组的快照，append，最多保留最近 200 条
}
interface GroupSnapshot {
  id: number; title: string; color: string;
  tabs: { url: string; title: string }[];
  updatedAt: string; deletedAt?: string;  // deletedAt 仅归档项有
}
```

**要点**:
- `archived` 独立于 `active`，Chrome 复用 groupId 时不会覆盖历史归档；误删的组保留在 `archived` 中可找回
- 所有写入都是 read-modify-write，通过 `queue`（并发=1）串行执行，无竞态
- 查看/导出：devtools → Application → Storage → Extension storage，或 console 跑 `chrome.storage.local.get('tabGroupBackup', console.log)`

---

## 关键点

- **无网络请求**: 代码中无 `fetch` / `XMLHttpRequest`，纯本地操作
- **无 content scripts**: 当前版本不注入任何脚本到页面
- **本地存储**: 仅使用 `chrome.storage.local` 保存标签组备份，无远程持久化；不再使用 `bookmarks` API
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

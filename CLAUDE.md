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

## 设计决策（有意为之，勿当 bug 修）

- **最小 API 调用优先**: 刻意不为防御性校验增加额外 Chrome API 调用。例如 `checkDuplicate` 开头取一次标签快照后一路 await，快照可能过期，但**不补 `tabs.get` 二次核对**——竞态窗口极小且 `catchError` 已兜底，最坏只是一条日志
- **相同 URL 去重是核心功能**: `checkDuplicate` 只要 URL 完全相同就激活旧标签、关闭新标签。"无法并排开两个相同网址"是预期行为，非缺陷
- **新窗口吸附全屏窗口**: `toFullscreenWindow` 会把 `!openerTabId && index===0` 的新普通窗口移进已有全屏窗口，Ctrl+N / 命令行开链接也会被吸附，属预期
- **`chrome://new` 关旧标签不查 pinned**: 打开新标签页时直接关掉重复的旧标签，未特判 pinned，属可接受的取舍

---

## 开发提示

1. 在 `chrome://extensions/` 加载 `dist/` 目录后，点击 Service Worker 的 "Service Worker" 链接可查看 console 日志
2. TypeScript 使用 ESM 导入（`.js` 后缀），如 `import { catchError } from './queue.js';`

---

## 发布更新

1. 修改 `manifest.json` 中的 `version`（**必须升号**，与线上版本重复会被商店拒绝）
2. `yarn release` 生成 `extension.zip`
3. 打开 devconsole 上传页，拖入 zip，提交审核：
   https://chrome.google.com/u/1/webstore/devconsole/27bf1380-10a4-4673-a253-0da100617e74/gnpaolggdcljndfmfealhoefoopkghch/edit/package

### 坑与必填项

- **新增权限必须在「隐私权规范」标签页填使用理由**，否则报"无法发布"。改动 `permissions` 后务必检查此页
- 本扩展**不收集/不传输任何数据**（纯本地 storage，无 fetch/XHR）→ 数据用途声明勾"不收集用户数据"，并勾选三条合规声明（不出售、不用于无关用途、不用于判定信用）
- 填完权限理由后需先**保存草稿**再重新提交审核

### 可复用文案（权限理由 / 单一用途）

- **storage**：用于将标签组（组名、颜色及组内标签的网址与标题）以快照形式保存到 `chrome.storage.local` 作为本地备份，便于标签组被误删后找回。数据仅存于本机，不上传、不共享
- **tabs**：用于查询和管理标签页，检测并合并重复网址标签，并读取标签所属分组以生成本地备份
- **tabGroups**：用于读取标签组的名称、颜色及成员标签，在标签组变化或被删除时生成本地备份快照
- **单一用途**：增强 Chrome 标签页与标签组管理——自动合并重复标签、整合全屏窗口，并将标签组自动备份到本地以防误删

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 项目概览

这是一个 **Chrome Manifest V3 扩展**，名为 "Private Browser Toolkit"。它通过 Service Worker 在后台监听浏览器事件，提供增强的标签页管理功能。

**权限**: `tabs`, `tabGroups`, `storage`, `unlimitedStorage`

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
| `tabs.onCreated` | 先重复检测，未命中且符合条件才吸附全屏窗口（联动，避免焦点打架） |
| `tabs.onUpdated` | URL 变化去重；complete、complete 后 title 再变、groupId 变化时备份相关组（离组/换组新旧组都拍） |
| `tabs.onRemoved` | 标签关闭后重拍其所属组（整窗关闭除外，组会随窗口被删、直接归档） |
| `tabs.onDetached` | 跨窗拖出后重拍原组（事件不带 groupId，靠缓存定位） |
| `tabGroups.onRemoved` | 归档该组快照（active key 移为归档 key，打 deletedAt） |
| `tabGroups.onUpdated` | 组名/颜色/折叠变化时备份该组并更新组对象缓存（无标题不拦截，新建组 title 本来就是空串）。首次快照由标签入组的 `tabs.onUpdated(groupId)` 负责，不监听 onCreated |
| 启动时 | 顶层立即 `tabs.query` 重建缓存；init 5 分钟节流。唤醒后若有归属事件抢在缓存就绪前（拿不到旧组），缓存模块记下 cold miss：重新查最新标签重建、无视节流强刷一次 |

### 队列: `worker/queue.ts`

```typescript
export const queue = new Queue(1);  // 并发数 = 1，确保 Chrome API 串行执行
```

- `Queue` 类：带并发控制的任务队列，每个 task 链上有 `.catch(catchError('queue'))` 兜底
- `catchError(context)`: 返回一个错误处理函数，输出到 console.error

**重要**: 所有 Chrome API 调用都通过 `queue.run()` 序列化执行，避免竞态条件。

### 内存缓存: `worker/groupCache.ts`

两个常驻 Map：

- `tabId -> groupId`（含未分组的 -1）：`tabs.onRemoved` / `onDetached` 事件不带 groupId、标签没了也查不到，只能靠事件前记下的归属定位要重拍的组；`onCreated` / `onUpdated` 维护，SW 启动时由一次 `tabs.query({})` 重建。`formerGroupOf` 在缓存未就绪时 miss（存了 -1 所以重建后不会误 miss），内部记一笔 cold miss 供启动强刷
- `groupId -> TabGroup`：组对象缓存，热路径 `backupGroup(number)` 直接命中、省一次 `tabGroups.get`；`tabGroups.onUpdated` 写入、`onRemoved` 摘除、init 用 `tabGroups.query` 结果预热。陈旧只影响 title/color（标签始终实时 query）

### 标签页管理: `worker/tabs.ts`

| 函数 | 作用 |
|------|------|
| `effectiveUrl(tab)` | 标签当前有效网址（`pendingUrl ?? url ?? ''`），去重比对与备份拍照共用同一口径 |
| `checkDuplicate(tabId)` → `boolean` | 查询全部标签，通过 `effectiveUrl` 比对检测重复（两边对称）。激活已存在标签，关闭新标签并返回 true；新标签保留时返回 false（供 onCreated 决定是否还要吸附全屏窗口）。特殊处理：新标签页(`chrome://new*`)、复制 tab、标签组场景。同 URL 老标签有多个时按 `pickTarget` 的 `PREFERENCE` 等级选目标：**同组/同窗 > 同窗可并入 > 跨窗可激活 > pinned/在别组（保留重复）**——不可操作的候选垫底，避免挡住跨窗可用目标 |
| `toFullscreenWindow(tabId, windowId)` | 如果存在全屏窗口，将新创建的普通窗口的第一个 tab 移动到全屏窗口中 |

### 标签组备份: `worker/backup.ts`

**核心机制**: 将 Chrome 标签组自动快照到 `chrome.storage.local`，出问题时可从中找回。纯数据保存，不做一键恢复，恢复靠人工读 JSON 重开。v2 存储拆 key（v1 的单 key `tabGroupBackup` 在首次 init 时自动迁移后删除）：

```
tabg:meta                     { lastInitAt }，仅做 5 分钟节流
tabg:g:<groupId>              存活组快照，每组一个 key；**键集合本身就是存活组真相**，不另存索引
tabg:a:<groupId>:<删除时间戳ms>  已删除组归档，只增不删、无条数上限
```

| 函数 | 作用 |
|------|------|
| `backupGroup(groupOrId)` | 读该组全部标签，**只 set 这一个组的 key**（不读不写其他数据）；传 id 时先查组对象缓存、miss 才 `tabGroups.get`；查不到标签（组已空）时**删掉该 key**——空组马上会被 Chrome 自动删除并归档，不能把刚关掉/拖走的最后一个标签留进归档 |
| `archiveGroup(groupId)` | 组被删除时，把 `tabg:g:<id>` 写成 `tabg:a:<id>:<ms>`（打 deletedAt）再删掉 active key；无快照则无事可做 |
| `initBackupAllGroups(allTabs, force)` | 缓存由调用方重建；5 分钟节流（force 跳过）；JS 内按 groupId 聚合；刷新存活组；存储里有但实时已不存在的组**移入归档**（漏删事件兜底，绝不硬删）；v1 数据首次发现时迁移 |

**数据结构**:
```typescript
interface GroupSnapshot {
  id: number; title: string; color: string;
  tabs: { url: string; title: string }[];
  updatedAt: string; deletedAt?: string;  // deletedAt 仅归档项有
}
```

**要点**:
- **备份只增不删**：归档无上限、不截断，Chrome 复用 groupId 时归档 key 带删除时间戳也不会互相覆盖；漏掉 `onRemoved` 的组在 init 时移入归档而非删除，误删的组永远可找回。靠 `unlimitedStorage` 权限解除 10MB 配额
- 热路径（标签 complete / 组更新）只有一次小组写入，不再全量重写整个备份对象，归档攒再多也不放大写入
- init 用 Chrome 130+ 的 `storage.getKeys()` **只枚举键名**（存活组就是 `tabg:g:` 前缀的键集合，与 `tabGroups.query` 的实时组做差集找死组），再定向读死组值归档——归档字节完全不碰；不支持 getKeys 的老版本特性检测回退 `get(null)` 全量读。不维护第二份组 id 索引，增删组无需同步 meta
- **空组不留快照**：组内最后一个标签被关掉或拖走时 Chrome 会自动删空组，此时删掉 active key、不归档，避免恢复时重开用户明确关掉的页面（正常删组不动标签，归档照常）
- 所有写入通过 `queue`（并发=1）串行执行，无竞态；读出的快照经 `sanitizeSnapshot` 归一，畸形数据当不存在，不会让后续备份永久抛错
- 查看/导出：devtools → Application → Storage → Extension storage，或 console 跑 `chrome.storage.local.get(null, console.log)`

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
- **新窗口吸附全屏窗口**: `toFullscreenWindow` 会把 `!openerTabId && index===0` 的新普通窗口移进已有全屏窗口，Ctrl+N / 命令行开链接也会被吸附，属预期。onCreated 里**先去重后吸附**：去重命中会关掉新标签，吸附白做还会让焦点在窗口间来回跳
- **`chrome://new` 关旧标签不查 pinned**: 打开新标签页时直接关掉重复的旧标签，未特判 pinned，属可接受的取舍
- **标签组不跨窗口**: 新标签在组里、同 URL 老标签在另一窗口时，不调 `tabs.group`（必失败），直接激活老标签、关新标签
- **备份只增不删**: 归档不设上限、不截断；init 发现 active 里有已不存在的组也只移入归档，不硬删——备份的价值就在于删了的东西还能找回来

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
- **unlimitedStorage**：标签组备份与历史归档持续累积、只增不删，用于解除 `storage.local` 默认约 10MB 的存储配额。全部数据仍仅存于本机，不上传、不共享
- **tabs**：用于查询和管理标签页，检测并合并重复网址标签，并读取标签所属分组以生成本地备份
- **tabGroups**：用于读取标签组的名称、颜色及成员标签，在标签组变化或被删除时生成本地备份快照
- **单一用途**：增强 Chrome 标签页与标签组管理——自动合并重复标签、整合全屏窗口，并将标签组自动备份到本地以防误删

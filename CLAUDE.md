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
| `yarn test` | 构建并运行 Node 内置 test runner 的 Chrome API mock 回归测试 |
| `yarn release` | 构建并打包为 `extension.zip` |

**输出目录**: `dist/` —— Chrome 加载扩展时选择此目录。

---

## 架构与核心模块

后台代码位于 `worker/`，设置与备份页为根目录 `options.ts` / `options.html`，均编译为 ES Module 输出到 `dist/`。功能开关存于 `chrome.storage.local` 的 `featureSettings`，`worker/settings.ts` 每次任务直接读取，默认全部开启，不维护设置缓存。

### 入口: `worker/index.ts`

注册 Chrome 事件监听器，所有异步操作通过串行队列执行：

| 事件 | 触发行为 |
|------|----------|
| `action.onClicked` | 打开扩展设置与备份查看页 |
| `tabs.onCreated` | 按开关先重复检测，未命中且符合条件才吸附全屏窗口（联动，避免焦点打架） |
| `tabs.onUpdated` | URL 变化时按开关去重；complete、complete 后 title 再变、groupId 变化时备份相关组（离组/换组新旧组都拍） |
| `tabs.onRemoved` | 标签关闭后重拍其所属组（整窗关闭除外，组会随窗口被删、直接归档） |
| `tabs.onDetached` | 跨窗拖出后重拍原组（事件不带 groupId，靠缓存定位） |
| `tabGroups.onRemoved` | 归档该组快照（active key 移为归档 key，打 deletedAt） |
| `tabGroups.onUpdated` | 更新组对象缓存；组名/颜色变化才备份，纯折叠变化不重写（快照不存 collapsed）。首次快照由标签入组的 `tabs.onUpdated(groupId)` 负责，不监听 onCreated |
| 启动时 | 顶层立即 `tabs.query` 重建缓存，事件新写入的归属不会被旧快照覆盖；init 5 分钟节流，查询失败直接中止。若有归属事件在缓存就绪前 miss：重新查最新标签重建、无视节流强刷一次 |

同组待执行备份由 `pendingGroupBackups` 合并，不加定时器；备份执行期间来了新事件，可再排一个尾随任务读取最新状态。

### 队列: `worker/queue.ts`

```typescript
export const queue = new Queue(1);  // 并发数 = 1，确保 Chrome API 串行执行
```

- `Queue` 类：带并发控制的任务队列，每个 task 链上有 `.catch(catchError('queue'))` 兜底
- `catchError(context)`: 返回一个错误处理函数，输出到 console.error

**重要**: 标签、窗口和备份的事件任务通过 `queue.run()` 序列化执行，避免竞态；启动预热查询、独立 action 与设置页不属于这条队列。

### 内存缓存: `worker/groupCache.ts`

两个常驻 Map：

- `tabId -> groupId`（含未分组的 -1）：`tabs.onRemoved` / `onDetached` 事件不带 groupId、标签没了也查不到，只能靠事件前记下的归属定位要重拍的组；`onCreated` / `onUpdated` 维护，SW 启动时由一次 `tabs.query({})` 重建。重建用 `changedTabs` 保护查询期间事件刚写入或删除的归属，不能用旧快照覆盖。`formerGroupOf` miss 时记 cold miss 供启动强刷
- `groupId -> TabGroup`：组对象缓存，非空组备份时省一次 `tabGroups.get`；`tabGroups.onUpdated` 写入、`onRemoved` 摘除、init 用 `tabGroups.query` 结果预热。只用于 title/color，**不参与空组判断**，缓存命中与否不得改变归档语义

### 标签页管理: `worker/tabs.ts`

| 函数 | 作用 |
|------|------|
| `effectiveUrl(tab)` | 标签当前有效网址（`pendingUrl ?? url ?? ''`），去重比对与备份拍照共用同一口径 |
| `checkDuplicate(tabId)` → `boolean` | 查询全部标签，通过 `effectiveUrl` 比对检测重复（两边对称）。激活已存在标签成功后才关闭新标签并返回 true；任一步失败抛给队列中止，不吞错继续破坏标签。新标签保留时返回 false（供 onCreated 决定是否还要吸附全屏窗口）。特殊处理：新标签页(`chrome://new*`)、复制 tab、标签组场景。同 URL 老标签有多个时按 `pickTarget` 的 `PREFERENCE` 等级选目标：**同组/同窗 > 同窗可并入 > 跨窗可激活 > pinned/在别组（保留重复）**——不可操作的候选垫底，避免挡住跨窗可用目标 |
| `toFullscreenWindow(tabId, windowId)` | 如果存在全屏窗口，将新普通窗口中唯一的 tab 移入，再激活并聚焦；源窗口有多标签或移动失败时不抢焦点 |

### 标签组备份: `worker/backup.ts`

**核心机制**: 将 Chrome 标签组自动快照到 `chrome.storage.local`，出问题时可从中找回。纯数据保存，不做一键恢复，恢复靠人工读 JSON 重开。v2 存储拆 key（v1 的单 key `tabGroupBackup` 在首次 init 时自动迁移后删除）：

```
tabg:meta                     { lastInitAt }，仅做 5 分钟节流
tabg:g:<groupId>              存活组快照，每组一个 key；**键集合本身就是存活组真相**，不另存索引
tabg:a:<groupId>:<删除时间戳ms>:<随机ID>  已删除组归档，只增不删、无条数上限
```

| 函数 | 作用 |
|------|------|
| `backupGroup(groupId, preserveEmpty)` | **先读该组全部标签**，非空才读取组对象（先查缓存、miss 才 `tabGroups.get` 并写入缓存），只 set 这一个组的 key。普通 complete/组更新快照用 `preserveEmpty=true`，空组时保留 active 等随后的 `onRemoved` 归档，避免排队竞态抢删；关闭、拖出、离组等明确空组事件仍删掉 active，避免把刚关掉/拖走的最后一个标签留进归档 |
| `archiveGroup(groupId)` | 组被删除时，把 `tabg:g:<id>` 写成 `tabg:a:<id>:<ms>:<随机ID>`（打 deletedAt）再删掉 active key；无快照则无事可做 |
| `initBackupAllGroups(allTabs, force)` | 缓存由调用方重建；5 分钟节流（force 跳过）；JS 内按 groupId 聚合；刷新存活组；存储里有但实时已不存在的组**移入归档**（漏删事件兜底，绝不硬删）；v1 数据首次发现时迁移；**先写归档/迁移再删旧 key**，写失败保留原数据 |

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
- 热路径（标签 complete / 组更新）只写相关小组，同组待执行备份会合并，不再全量重写整个备份对象，归档攒再多也不放大写入
- init 用 Chrome 130+ 的 `storage.getKeys()` **只枚举键名**（存活组就是 `tabg:g:` 前缀的键集合，与 `tabGroups.query` 的实时组做差集找死组），再定向读死组值归档——归档字节完全不碰；不支持 getKeys 的老版本特性检测回退 `get(null)` 全量读。不维护第二份组 id 索引，增删组无需同步 meta
- **空组不留快照**：组内最后一个标签被关掉或拖走时 Chrome 会自动删空组，此时删掉 active key、不归档，避免恢复时重开用户明确关掉的页面（正常删组不动标签，归档照常）
- 所有写入通过 `queue`（并发=1）串行执行，无竞态；读出的快照经 `sanitizeSnapshot` 归一，畸形数据当不存在，不会让后续备份永久抛错
- 查看/导出：点击扩展图标打开设置与备份页，可复制或导出 JSON；也可在 devtools → Application → Storage → Extension storage 查看

---

## 关键点

- **无网络请求**: 代码中无 `fetch` / `XMLHttpRequest`，纯本地操作
- **无 content scripts**: 当前版本不注入任何脚本到页面
- **本地存储**: 仅使用 `chrome.storage.local` 保存功能开关与标签组备份，无远程持久化；不再使用 `bookmarks` API
- **错误处理**: 队列统一用 `catchError('queue')` 记录异步任务错误；去重、移动、删除等连续操作**不在调用点吞错继续**，前置步骤失败必须中止，独立入口用 `catchError(context)` 兜底

---

## 设计决策（有意为之，勿当 bug 修）

- **最小 API 调用优先**: 刻意不为防御性校验增加额外 Chrome API 调用。例如 `checkDuplicate` 开头取一次标签快照后一路 await，快照可能过期，但**不补 `tabs.get` 二次核对**——竞态窗口极小且队列已兜底；但激活等前置步骤失败时不得继续删除标签
- **相同 URL 去重是核心功能**: `checkDuplicate` 只要 URL 完全相同就激活旧标签、关闭新标签。"无法并排开两个相同网址"是预期行为，非缺陷；可在设置页整体关闭该功能
- **新窗口吸附全屏窗口**: `toFullscreenWindow` 会把 `!openerTabId && index===0` 且源窗口仍只有当前 tab 的新普通窗口移进已有全屏窗口，Ctrl+N / 命令行开链接也会被吸附，属预期；多标签窗口不拆散。onCreated 里**先去重后吸附**：去重命中会关掉新标签，吸附白做还会让焦点在窗口间来回跳；可在设置页整体关闭该功能
- **`chrome://new` 关旧标签不查 pinned**: 打开新标签页时直接关掉重复的旧标签，未特判 pinned，属可接受的取舍
- **标签组不跨窗口**: 新标签在组里、同 URL 老标签在另一窗口时，不调 `tabs.group`（必失败），直接激活老标签、关新标签
- **备份只增不删**: 归档不设上限、不截断；init 发现 active 里有已不存在的组也只移入归档，不硬删——备份的价值就在于删了的东西还能找回来

---

## 开发提示

1. 在 `chrome://extensions/` 加载 `dist/` 目录后，点击 Service Worker 的 "Service Worker" 链接可查看 console 日志
2. TypeScript 使用 ESM 导入（`.js` 后缀），如 `import { catchError } from './queue.js';`
3. `yarn test` 使用 Node 内置 test runner 与轻量 Chrome API mock，覆盖失败路径和事件时序；它不替代真实 Chrome 的窗口/标签事件回归

---

## 发布更新

商店网页操作固定使用 **CDP + Playwright**：先检查 `http://127.0.0.1:9222/json/version`；若 CDP 未启动，直接执行 `chrome cdp`（使用独立 `Chrome CDP` profile，复用本机 9222 端口和其中的登录态）。随后用 `playwright.chromium.connectOverCDP('http://127.0.0.1:9222')` 连接并操作网页，不要另开无登录态的浏览器

1. 修改 `manifest.json` 中的 `version`（**必须升号**，与线上版本重复会被商店拒绝）
2. `yarn release` 生成 `extension.zip`
3. 用 Playwright 打开 devconsole 上传页，通过文件控件上传 `extension.zip`：
   https://chrome.google.com/u/1/webstore/devconsole/27bf1380-10a4-4673-a253-0da100617e74/gnpaolggdcljndfmfealhoefoopkghch/edit/package
4. 检查「隐私权规范」（新权限理由、数据使用、合规声明）和「商品详情」说明，各页**保存草稿**
5. 「提请审核」变蓝后提交，确认框勾选"通过审核后自动发布"
6. 提交后重新读取「状态」和「文件包」页，确认新草稿版本处于「待审核」；审核通过自动发布，不把「已送审」当成「已上线」

**“提交、合并发布”是完整发版指令**：商店送审完成后，不等用户再提醒，自动将发布分支合并回 `main`、创建合并提交并推送 `origin/main`，最后核对本地与远端提交一致、工作区干净。商店仍在审核不影响代码收尾，但结果中要明确版本尚未上线

### 坑与必填项

- **新增权限必须在「隐私权规范」标签页填使用理由**，否则报"无法发布"。改动 `permissions` 后务必检查此页
- **商店文案要与当前功能/manifest 对齐**：发版前通读「商品详情 → 说明」和「隐私权规范 → 单一用途」，删掉已移除能力的描述。0.3.0 移除 bookmarks API 后，两处仍写着"书签同步/bookmarks API"，与 manifest 不符可能被以描述不实打回
- 本扩展**不收集/不传输任何数据**（纯本地 storage，无 fetch/XHR）→ 数据使用类别一项都不勾（即"不收集用户数据"），并勾选三条合规声明（不出售、不用于无关用途、不用于判定信用）；不收集数据时隐私政策 URL 可留空
- 各标签页改完先**保存草稿**，右上角「提请审核」变蓝后再提交；提交确认框里勾选"通过审核后自动发布"可免过审后二次操作
- **审核中的版本不能修改或替换**：上传按钮会被商店禁用；若新版本必须取而代之，先取得用户确认，再从更多菜单取消当前审核，刷新确认恢复草稿后再上传。不要强行修改 disabled 或绕过商店限制

### 可复用文案（权限理由 / 单一用途）

- **storage**：用于保存功能开关，并将标签组（组名、颜色及组内标签的网址与标题）以快照形式保存到 `chrome.storage.local` 作为本地备份，便于标签组被误删后找回。数据仅存于本机，不上传、不共享
- **unlimitedStorage**：标签组备份与历史归档持续累积、只增不删，用于解除 `storage.local` 默认约 10MB 的存储配额。全部数据仍仅存于本机，不上传、不共享
- **tabs**：用于查询和管理标签页，检测并合并重复网址标签，并读取标签所属分组以生成本地备份
- **tabGroups**：用于读取标签组的名称、颜色及成员标签，在标签组变化或被删除时生成本地备份快照
- **单一用途**：增强 Chrome 标签页与标签组管理——自动合并重复标签、整合全屏窗口，并将标签组自动备份到本地以防误删

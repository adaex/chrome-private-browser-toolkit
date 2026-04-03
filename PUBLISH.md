# Chrome 扩展第一次上架发布流程

> 开发者账号已就绪，按照此流程一步步操作即可完成上架

---

## 一、上架前准备清单

### 1.1 构建生产版本

在项目根目录执行：

```bash
yarn release
```

这会自动构建并生成 `extension.zip` 文件用于上传。

### 1.2 资源文件准备

Chrome 网上应用店需要以下资源，**请提前准备**：

| 资源类型 | 尺寸要求 | 格式 | 说明 |
| -------- | -------- | ---- | ---- |
| 扩展图标 | 128x128 | PNG | 已准备（manifest 中配置） |
| 商店图标 | 128x128 | PNG | **需要准备**（建议白底，圆角） |
| 截图 | 1280x800 或 640x400 | PNG/JPG | **需要准备**（至少 1 张，最多 5 张） |
| 小宣传图 | 440x280 | PNG/JPG | 可选 |
| 大宣传图 | 920x680 | PNG/JPG | 可选 |
| marquee 宣传图 | 1400x560 | PNG/JPG | 可选 |

> 💡 截图建议：展示扩展的核心功能界面，至少准备 3 张效果更好

### 1.3 确认 manifest.json 信息

当前配置已就绪：

```json
{
  "manifest_version": 3,
  "name": "Private Browser Toolkit",
  "description": "A private browser toolkit for chrome.",
  "version": "0.1.0"
}
```

---

## 二、商店信息填写模板

以下是已为你生成好的商店信息，直接复制使用即可。

### 2.1 基本信息

| 字段 | 内容 |
| ---- | ---- |
| **标题** | Private Browser Toolkit |
| **副标题（可选）** | 智能标签页管理与书签同步工具 |
| **描述（详细）** | 见下方「详细描述」 |
| **类别** | 生产效率 / 实用工具 |
| **语言** | 中文（简体）、English |
| **网站 URL（可选）** | 项目 GitHub 地址 |
| **支持网址（可选）** | GitHub Issues 地址 |

### 2.2 详细描述（中文）

```text
Private Browser Toolkit 是一款高效的浏览器增强工具，帮助你更好地管理标签页和书签。

=== 核心功能 ===

🔄 智能标签页管理
• 自动检测重复标签页，保持浏览器整洁
• 支持将新标签页自动移动到全屏窗口
• 智能识别标签组中的重复内容

📚 标签组书签同步
• 自动将标签组内容同步到书签文件夹
• 使用 emoji 图标标识不同颜色的标签组
• 标签组变化时实时更新对应书签
• 一键备份和恢复你的标签组结构

=== 为什么选择它？ ===

✓ 轻量高效：基于 Manifest V3 架构，性能更优
✓ 自动运行：后台静默工作，无需手动操作
✓ 数据安全：所有数据本地存储，不联网上传

=== 权限说明 ===

• tabs：管理标签页，检测重复标签
• tabGroups：管理标签组，同步标签组状态
• bookmarks：创建和管理书签文件夹

如有问题或建议，欢迎在 GitHub 提交 Issue。
```

### 2.3 详细描述（英文）

```text
Private Browser Toolkit is an efficient browser enhancement tool that helps you better manage tabs and bookmarks.

=== Core Features ===

🔄 Smart Tab Management
• Automatically detect duplicate tabs to keep your browser organized
• Support moving new tabs to fullscreen windows automatically
• Intelligently identify duplicates within tab groups

📚 Tab Group Bookmark Sync
• Automatically sync tab group contents to bookmark folders
• Use emoji icons to identify tab groups of different colors
• Real-time bookmark updates when tab groups change
• One-click backup and restore for your tab group structures

=== Why Choose It? ===

✓ Lightweight & Efficient: Built on Manifest V3 architecture for better performance
✓ Automatic Operation: Works silently in the background, no manual action needed
✓ Data Safe: All data stored locally, no network upload

=== Permissions Explained ===

• tabs: Manage tabs and detect duplicates
• tabGroups: Manage tab groups and sync their state
• bookmarks: Create and manage bookmark folders

Feel free to open an issue on GitHub if you have any questions or suggestions.
```

### 2.4 隐私政策

由于此扩展**不收集任何用户数据**，隐私政策可以简洁说明：

```text
隐私政策

Private Browser Toolkit 尊重并保护您的隐私。

数据收集：
• 本扩展不收集任何个人身份信息
• 本扩展不向任何外部服务器发送数据
• 所有操作仅在本地浏览器中执行

数据存储：
• 扩展仅使用 Chrome 原生的书签和标签页 API
• 所有数据存储在您的本地浏览器中

如有疑问，请通过 GitHub Issues 联系我们。
```

英文版本：

```text
Privacy Policy

Private Browser Toolkit respects and protects your privacy.

Data Collection:
• This extension does not collect any personally identifiable information
• This extension does not send data to any external servers
• All operations are performed locally in your browser

Data Storage:
• The extension only uses Chrome's native bookmarks and tabs APIs
• All data is stored locally in your browser

If you have any questions, please contact us via GitHub Issues.
```

---

## 三、详细上架步骤

### 步骤 1：打包扩展

在项目根目录执行：

```bash
yarn release
```

执行完成后，项目根目录会生成 `extension.zip` 用于上传。

> ⚠️ 重要：zip 文件的根目录应直接包含 manifest.json，而不是嵌套在文件夹中

### 步骤 2：登录开发者控制台

1. 打开 [Chrome 网上应用店开发者控制台](https://chrome.google.com/webstore/devconsole)
2. 使用你的开发者账号登录
3. 接受开发者协议（首次登录需要）

### 步骤 3：创建新扩展

1. 点击「**新建项目**」或「**New Item**」
2. 上传刚才打包的 `extension.zip` 文件
3. 等待上传完成

### 步骤 4：填写商店信息

按照「**第二部分：商店信息填写模板**」填写以下内容：

#### 列表信息（Listing）

| 字段 | 操作 |
| ---- | ---- |
| 标题 | 填入：`Private Browser Toolkit` |
| 副标题（可选） | 填入：`智能标签页管理与书签同步工具` |
| 描述 | 复制「2.2 详细描述」的内容 |
| 类别 | 选择：`生产效率` 或 `Productivity` |
| 语言 | 添加：`中文（简体）` 和 `English` |

#### 图片资源（Graphic assets）

按要求上传准备好的图片：

- 商店图标（128x128 PNG）
- 截图（至少 1 张，建议 3-5 张）
- 宣传图（可选）

#### 隐私政策（Privacy）

1. 选择「**此扩展不收集任何用户数据**」（如果有此选项）
2. 或在「隐私政策」字段粘贴「2.4 隐私政策」的内容
3. 如有自己的网站，可填写隐私政策页面 URL

### 步骤 5：分发设置

#### 定价和分发（Pricing & distribution）

| 字段 | 推荐设置 |
| ---- | -------- |
| 价格 | 免费 |
| 可见性 | 公开（Public） |
| 地区 | 所有地区 或 特定地区 |

> 💡 首次上架建议选择「公开」，让所有人都能找到

### 步骤 6：内容评分（Content ratings）

需要完成内容调查问卷：

1. 扩展类型选择：`实用工具 / 生产力工具`
2. 回答关于内容的问题（此扩展不涉及敏感内容）
3. 提交获取内容评级

### 步骤 7：提交审核

1. 检查所有必填项是否已完成（会有红色提示）
2. 点击「**提交审核**」或「**Submit for review**」
3. 确认提交

---

## 四、审核期间与发布后

### 4.1 审核时间

- 首次上架审核通常需要 **1-3 个工作日**
- 复杂扩展可能需要更长时间
- 你会收到邮件通知审核结果

### 4.2 如果审核被拒

常见原因及解决：

| 原因 | 解决方案 |
| ---- | -------- |
| 描述不清楚 | 优化描述，明确说明功能 |
| 缺少截图 | 添加清晰的功能截图 |
| 权限说明不足 | 在描述中详细解释每个权限的用途 |
| 功能问题 | 本地测试后修复重新提交 |

### 4.3 发布成功后

审核通过后：

- 扩展会自动上线
- 你会收到发布成功的邮件
- 可以在开发者控制台查看安装统计

---

## 五、快速检查清单

上架前确认：

- [ ] 已运行 `yarn release` 生成 `extension.zip`
- [ ] 已正确打包 zip（根目录含 manifest.json）
- [ ] 已准备商店图标（128x128 PNG）
- [ ] 已准备截图（至少 1 张）
- [ ] manifest.json 中 version 正确（0.1.0）
- [ ] 已准备好中文和英文描述
- [ ] 开发者账号已激活并支付注册费

---

## 六、后续版本更新

发布成功后，后续更新流程：

1. 修改 `manifest.json` 中的 `version`（如 0.1.1）
2. 运行 `yarn release` 构建新的 zip 包
3. 在开发者控制台找到该扩展
4. 上传新的 zip 包
5. 更新描述（如有需要）
6. 提交审核（更新审核通常更快）

---

## 附录：常用链接

| 用途 | 链接 |
| ---- | ---- |
| 开发者控制台 | [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole) |
| 开发者文档 | [developer.chrome.com/docs/webstore](https://developer.chrome.com/docs/webstore/) |
| 上架政策 | [developer.chrome.com/docs/webstore/program-policies](https://developer.chrome.com/docs/webstore/program-policies/) |
| Manifest V3 文档 | [developer.chrome.com/docs/extensions/mv3](https://developer.chrome.com/docs/extensions/mv3/) |

---

> 💡 提示：如果在任何步骤遇到问题，先查看 Chrome 开发者文档，或检查邮件中的审核反馈。祝上架顺利！

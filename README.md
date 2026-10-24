# Private Browser Toolkit

一个用于 Chrome 浏览器的私人工具包扩展，提供增强的标签页管理和标签组本地备份功能。

## 功能特性

### 🔄 智能标签页管理

- **重复标签检测**：自动检测并合并重复的标签页，可在设置页关闭
- **全屏窗口整合**：自动将新开的单标签普通窗口并入全屏窗口，可在设置页关闭
- **标签组支持**：智能处理标签组中的重复标签

### 💾 标签组本地备份

- **自动备份**：将标签组内容（组名、颜色、组内标签的 url/title）自动快照到 `chrome.storage.local`
- **误删可找回**：标签组被删除时归档保留，不随删除丢失
- **数据查看与导出**：点击扩展图标打开设置与备份页，可刷新、复制或导出备份 JSON；按其中的网址手动重开即可恢复

## 安装方式

1. 克隆项目到本地：

   ```bash
   git clone <repository-url>
   cd chrome-private-browser-toolkit
   ```

2. 安装依赖：

   ```bash
   yarn
   ```

3. 构建扩展：

   ```bash
   yarn build
   ```

4. 在 Chrome 中加载扩展：
   - 打开 `chrome://extensions/`
   - 开启"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择项目的 `dist` 文件夹

## 开发

### 开发模式

```bash
yarn dev
```

### 构建与测试

```bash
yarn build
yarn test
```

测试使用 Node 内置 test runner 和轻量 Chrome API mock，不需要额外测试依赖；真实窗口和标签事件仍应在 Chrome 中回归。

### 发布打包

```bash
yarn release
```

## 项目结构

```
├── manifest.json          # 扩展清单文件
├── package.json           # 项目配置
├── tsconfig.json          # TypeScript 配置
├── options.html           # 功能开关与备份查看页
├── options.ts             # 设置页逻辑
├── icon/                  # 扩展图标
├── tests/                 # Node 内置 test runner 回归测试
└── worker/                # Service Worker 脚本
    ├── queue.ts           # 串行队列实现
    ├── tabs.ts            # 标签页管理（重复检测、全屏窗口）
    ├── backup.ts          # 标签组本地备份（storage.local）
    ├── settings.ts        # 功能开关读写
    ├── groupCache.ts      # 标签与组对象缓存
    └── index.ts           # 入口文件、事件监听器
```

## 权限说明

- `tabs`：管理标签页，检测重复标签，读取组内标签以生成备份
- `tabGroups`：读取标签组名称、颜色和删除事件
- `storage`：保存功能开关与标签组备份
- `unlimitedStorage`：解除本地备份持续累积时的默认存储配额

## 技术栈

- **TypeScript**：类型安全的开发体验
- **ES Modules**：现代模块化架构
- **Chrome Extensions API**：Manifest V3

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目。

## 许可证

请查看项目根目录的许可证文件。

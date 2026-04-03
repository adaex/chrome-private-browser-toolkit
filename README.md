# Private Browser Toolkit

一个用于 Chrome 浏览器的私人工具包扩展，提供增强的标签页管理和书签同步功能。

## 功能特性

### 🔄 智能标签页管理

- **重复标签检测**：自动检测并合并重复的标签页
- **全屏窗口整合**：自动将新标签页移动到全屏窗口中
- **标签组支持**：智能处理标签组中的重复标签

### 📚 标签组书签同步

- **自动同步**：将标签组内容自动同步到书签文件夹
- **颜色标识**：使用 emoji 图标标识不同颜色的标签组
- **实时更新**：标签组变化时自动更新对应的书签文件夹

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

### 构建生产版本

```bash
yarn build
```

## 项目结构

```
├── manifest.json          # 扩展清单文件
├── package.json           # 项目配置
├── tsconfig.json          # TypeScript 配置
├── icon/                  # 扩展图标
└── worker/                # Service Worker 脚本
    ├── queue.ts           # 并发队列实现
    ├── tabs.ts            # 标签页管理（重复检测、全屏窗口）
    ├── bookmarks.ts       # 标签组书签同步
    └── index.ts           # 入口文件、事件监听器
```

## 权限说明

- `tabs`：管理标签页，检测重复标签
- `tabGroups`：管理标签组，同步标签组状态
- `bookmarks`：创建和管理书签文件夹

## 技术栈

- **TypeScript**：类型安全的开发体验
- **ES Modules**：现代模块化架构
- **Chrome Extensions API**：Manifest V3

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目。

## 许可证

请查看项目根目录的许可证文件。

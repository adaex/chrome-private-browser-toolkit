# AGENTS.md

## 项目

Private Browser Toolkit 是 Chrome Manifest V3 扩展，提供直连与本机 SOCKS5 切换、标签页管理和标签组本地备份，后台使用 Service Worker

Chrome 加载构建后的 `dist/`，不要直接加载仓库根目录

## 工作方式

- 按文档地图只打开当前任务需要的文档或章节，不要预读其他主题文档
- 修改代码后至少运行 `yarn test`；需要真实 Chrome 回归的场景按测试文档执行
- 用户说“提交、合并发布”时，执行发布文档中的完整流程，不停在本地打包或等待审核

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `yarn dev` | TypeScript 监听编译；首次先运行 `yarn build` |
| `yarn build` | 清理并重新生成 `dist/` |
| `yarn test` | 构建并运行 Node 内置 test runner 的 Chrome API mock 回归测试 |
| `yarn release` | 仅构建并打包 `extension.zip`，不上传、不送审 |

## 文档地图

| 文档 | 什么时候打开 |
| --- | --- |
| [README.md](README.md) | 修改用户可见功能、安装方式、权限或项目结构时，核对并更新 |
| [docs/architecture.md](docs/architecture.md) | 修改后台或页面脚本时只读相关章节；改入口、队列或跨模块交互时另读「后台入口与事件」「队列与错误处理」 |
| [docs/testing.md](docs/testing.md) | 修改测试，或需要真实 Chrome 回归时 |
| [docs/release.md](docs/release.md) | 完整发版读全文；开发者后台单点操作只读对应章节 |
| [design/icon-states/README.md](design/icon-states/README.md) | 更换、重绘或导出代理状态图标时 |

## 关键边界

- 不引入网络请求、远程持久化或 content scripts；功能开关、代理端口和标签组备份只保存在本机 `chrome.storage.local`
- 清单的 `incognito: "split"` 必须与后台入口隔离同时保留；无痕进程不注册业务监听、不查询标签、不读写备份
- 标签／窗口／备份任务与代理写入分别使用独立串行队列，不能合并成互相阻塞的一条队列
- 有效标签组归档只增不删，不提供一键恢复；不要添加截断、自动清理或猜测来源的迁移
- 最小 API 调用、相同 URL 去重、新窗口吸附全屏窗口等例外是有意设计，修改前先看架构文档，不按缺陷直接删掉

TypeScript 使用 ESM 导入并保留 `.js` 后缀，例如 `import { catchError } from './queue.js'`

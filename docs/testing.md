# 测试与真实 Chrome 回归

自动化测试、真实 Chrome 回归与外部代理切换的验证方法

## 自动化回归

```bash
yarn test
```

该命令先构建，再用 Node 内置 test runner 和轻量 Chrome API mock 运行 `tests/*.test.mjs`。测试覆盖失败路径和事件时序，不需要额外测试依赖

mock 不能替代真实 Chrome 的代理设置、窗口和标签事件回归。修改代理、标签组生命周期或无痕隔离后必须实测；其他窗口／标签事件变更也不能只靠 mock 判断行为正确

## 实测边界

- 使用隔离 Chrome profile 和临时扩展副本，不操作用户自己的代理设置或备份数据
- 缺少 Playwright 时安装到 `/tmp`，不做全局安装
- 测试钩子只放临时副本，不进入提交或发布包
- 结束后关闭自己启动的浏览器和进程，删除临时依赖、脚本、截图与 profile

## Chrome 137+ 加载扩展

不要依赖已移除的 `--load-extension`。使用 `launchPersistentContext` 经 CDP pipe 启动隔离 profile，并满足以下配置：

- `ignoreDefaultArgs` 去掉 `--disable-extensions`
- `args` 加 `--enable-unsafe-extension-debugging`
- 用 `browser.newBrowserCDPSession()` 调 `Extensions.loadUnpacked` 加载构建产物或临时副本

Service Worker 调试求值不能动态 `import()`

在 `chrome://extensions/` 加载 `dist/` 后，也可以点击 Service Worker 链接查看 console 日志

## 外部代理切换实测

并发外部切换场景必须用外部命令直接打开目标扩展 URL，不要先 `newPage()` 创建 `about:blank`，否则页面可能在导航前被重复标签合并

实测至少区分相同模式跳过写入、其他扩展控制时拒绝、成功后自动关页和失败后保留页面；不得把 `switch.html` 加入 `web_accessible_resources`

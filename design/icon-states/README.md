# 代理状态图标候选

当前正式使用 **2.5A**，同名文件已复制到 `icon/socks5_*.png`。优先级：**2.5A ＞ 2.5B ＞ 3A**。

| 方案 | 内孔直径（16px 源图标） | 空心圆点 |
| --- | --- | --- |
| `2.5A` | 2.5px | 三个圆点都是空心 |
| `2.5B` | 2.5px | 仅顶部空心，下面两个实心 |
| `3A` | 3px | 三个圆点都是空心 |

所有方案都保留原始三圆点的颜色、外径、圆心和透明背景，32px、48px 文件按相同比例生成。直连直接复用 `icon/icon_*.png` 的原始三色实心图标，其他模式使用灰色实心图标。

## 在实际场景中替换

在仓库根目录执行，例如切换到 2.5B：

```bash
cp design/icon-states/2.5B/socks5_*.png icon/
yarn build
```

然后在 `chrome://extensions/` 重新加载扩展。恢复当前默认：

```bash
cp design/icon-states/2.5A/socks5_*.png icon/
yarn build
```

这里只保存可替换资源，不增加运行时图标样式设置。`design/` 不进入 `dist` 或发布 zip。

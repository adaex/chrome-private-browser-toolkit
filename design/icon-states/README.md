# 代理状态图标候选

当前正式使用 **2.5A**，对应正式文件为 `icon/socks5.svg` 和 `icon/socks5_*.png`。每个候选目录只保留一份 `socks5.svg`，按需选择，不再重复存放导出的 PNG

| 方案 | 内孔直径（16px 源图标） | 空心圆点 |
| --- | --- | --- |
| `2.5A` | 2.5px | 三个圆点都是空心 |
| `2.5B` | 2.5px | 仅顶部空心，下面两个实心 |
| `3A` | 3px | 三个圆点都是空心 |

所有方案共用同一套三圆几何：以 128×128 画布为基准，固定一个圆在上、两个圆在下，整体关于 `x=64` 中轴对称，不得旋转构图。圆点外径为 56px，三个圆心严格构成等边三角形，任意两圆的圆心距均为 72px、净间距均为 16px；左右透明边距为 0，上下边距均为约 4.82px 并保持外接框居中。正立等边三角形的外接框宽大于高，因此不得为了四边同时贴边而旋转或改变构图。保留原始配色与透明背景，其他模式使用灰色实心圆点

`icon/icon.svg`、`icon/socks5.svg`、`icon/other.svg` 是正式图标的矢量源。弹窗与设置页直接使用 SVG；Chrome 清单和工具栏所需的 PNG 从对应 SVG 按标称尺寸导出，不再缩放其他 PNG

## 在实际场景中替换

在仓库根目录执行，例如切换到 2.5B：

```bash
cp design/icon-states/2.5B/socks5.svg icon/socks5.svg
```

随后必须从新的 `icon/socks5.svg` 按标称尺寸重新导出 `icon/socks5_16.png`、`icon/socks5_32.png` 和 `icon/socks5_48.png`，不要缩放其他 PNG。恢复默认时把源路径换为 `design/icon-states/2.5A/socks5.svg`，并同样重新导出；SVG 与 PNG 必须同步更新

然后构建：

```bash
yarn build
```

在 `chrome://extensions/` 重新加载扩展即可预览。这里只保存 SVG 方案，不增加运行时图标样式设置；`design/` 不进入 `dist` 或发布 zip

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('弹窗与设置页的品牌图使用 SVG', async () => {
  const pages = ['popup.html', 'options.html'];
  const htmls = await Promise.all(pages.map(page => readFile(new URL(page, root), 'utf8')));
  for (const html of htmls) {
    const sources = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(sources, ['icon/icon.svg']);
  }
});

test('Chrome 使用的 PNG 实际尺寸与文件名一致', async () => {
  const files = (await readdir(new URL('icon/', root))).filter(file => file.endsWith('.png'));
  assert.ok(files.length > 0);
  const pngs = await Promise.all(files.map(file => readFile(new URL(`icon/${file}`, root))));
  for (const [index, file] of files.entries()) {
    const match = file.match(/_(\d+)\.png$/);
    assert.ok(match, `无法从文件名识别标称尺寸：${file}`);
    const expected = Number(match[1]);
    const png = pngs[index];
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} 不是有效 PNG`);
    assert.equal(png.readUInt32BE(16), expected, `${file} 宽度不正确`);
    assert.equal(png.readUInt32BE(20), expected, `${file} 高度不正确`);
  }
});

function attribute(source, name) {
  return source.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
}

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.00001, `${message}：${actual} ≠ ${expected}`);
}

test('所有 SVG 均为一上两下、左右对称、三圆等距且左右贴边', async () => {
  const files = [
    'icon/icon.svg',
    'icon/socks5.svg',
    'icon/other.svg',
    'design/icon-states/2.5A/socks5.svg',
    'design/icon-states/2.5B/socks5.svg',
    'design/icon-states/3A/socks5.svg',
  ];
  const svgs = await Promise.all(files.map(file => readFile(new URL(file, root), 'utf8')));
  for (const [index, file] of files.entries()) {
    const svg = svgs[index];
    const group = svg.match(/<g\b([^>]*)>/);
    assert.ok(group, `${file} 缺少统一圆心变换`);
    const translate = attribute(group[1], 'transform')?.match(/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/);
    assert.ok(translate, `${file} 缺少整体位移`);
    const tx = Number(translate[1]);
    const ty = Number(translate[2]);
    const groupStroke = Number(attribute(group[1], 'stroke-width') ?? 0);
    const circles = [...svg.matchAll(/<circle\b([^>]*)\/>/g)].map(match => {
      const attrs = match[1];
      const angle = Number(attribute(attrs, 'transform')?.match(/rotate\(([-\d.]+)\)/)?.[1] ?? 0) * Math.PI / 180;
      const cx = Number(attribute(attrs, 'cx') ?? 0);
      const cy = Number(attribute(attrs, 'cy') ?? 0);
      const stroke = Number(attribute(attrs, 'stroke-width') ?? groupStroke);
      return {
        x: tx + cx * Math.cos(angle) - cy * Math.sin(angle),
        y: ty + cx * Math.sin(angle) + cy * Math.cos(angle),
        radius: Number(attribute(attrs, 'r')) + stroke / 2,
      };
    });
    assert.equal(circles.length, 3, `${file} 必须恰好有三个圆`);
    for (const circle of circles) assertClose(circle.radius, 28, `${file} 圆点外径不一致`);
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const a = circles[i];
        const b = circles[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        assertClose(distance, 72, `${file} 圆心距不一致`);
        assertClose(distance - a.radius - b.radius, 16, `${file} 圆点净间距不一致`);
      }
    }

    assert.ok(circles[0].y < circles[1].y, `${file} 必须保持一个圆在上、两个圆在下`);
    assertClose(circles[0].x, 64, `${file} 顶部圆点未位于中轴`);
    assertClose(circles[1].y, circles[2].y, `${file} 底部两个圆点未水平对齐`);
    assertClose((circles[1].x + circles[2].x) / 2, 64, `${file} 底部两个圆点未左右镜像`);

    const left = Math.min(...circles.map(circle => circle.x - circle.radius));
    const right = Math.max(...circles.map(circle => circle.x + circle.radius));
    const top = Math.min(...circles.map(circle => circle.y - circle.radius));
    const bottom = Math.max(...circles.map(circle => circle.y + circle.radius));
    assertClose((left + right) / 2, 64, `${file} 横向外接框未居中`);
    assertClose((top + bottom) / 2, 64, `${file} 纵向外接框未居中`);
    assertClose(left, 0, `${file} 左侧仍有透明边距`);
    assertClose(right, 128, `${file} 右侧仍有透明边距`);
    assertClose(top, 4.823085, `${file} 顶部边距未按等边布局居中`);
    assertClose(bottom, 123.176915, `${file} 底部边距未按等边布局居中`);
  }
});

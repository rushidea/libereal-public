#!/usr/bin/env python3
"""
LIBEREAL 促销活动 OG 封面生成器（1200×630 JPG，可复用）。

视觉风格沿用 cytiva / labgic / multisciences / labselect-culture-plates
那套统一模板：左 45% 绿色渐变面板（左上白底圆角放 LIBEREAL 树形品牌标 +
品牌中文名 + eyebrow + 大标题 + 副标题 + 左下脚注），右 55% 实物图。

约定：
  - 输出 1200×630、JPG quality≈86 + optimize + progressive、目标 <200KB
    （微信 iOS 严格要求，否则不显示）。
  - 不用 WebP，绝不当竖图海报。
  - 字体优先 macOS 冬青黑体（简体）→ 华文黑体 → 苹方 → Arial Unicode，
    全部走绝对路径，找不到就退化到 Pillow 默认字体。

用法：
  python scripts/gen_promo_og.py                     # 渲染内置预设（labselect + biosharp 两个 hub）
  python scripts/gen_promo_og.py --config cover.json # 渲染自定义配置
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
PANEL_W = 540  # 左侧绿色面板宽度

# 品牌绿（与 cytiva/labgic/multisciences 已上线封面同色系，做细微渐变增加质感）
GREEN_TOP = (34, 158, 110)
GREEN_BOT = (22, 130, 90)

# 字体候选（macOS），按顺序回退。简体中文优先 Hiragino Sans GB（冬青黑体）。
FONT_CANDIDATES: list[tuple[str, int]] = [
    ('/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
    ('/System/Library/Fonts/STHeiti Medium.ttc', 0),
    ('/System/Library/Fonts/STHeiti Light.ttc', 0),
    ('/System/Library/Fonts/PingFang.ttc', 0),
    ('/Library/Fonts/Arial Unicode.ttf', 0),
]


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """按候选顺序加载字体，全部失败回退到 Pillow 默认。"""
    for path, index in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size, index=index)
            except Exception:
                continue
    return ImageFont.load_default()


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_w: int,
) -> list[str]:
    """按像素宽度贪心换行；显式 \\n 强制换行；最多 3 行。"""
    lines: list[str] = []
    for raw in text.split('\n'):
        cur = ''
        for ch in raw:
            test = cur + ch
            if cur and draw.textlength(test, font=font) > max_w:
                lines.append(cur)
                cur = ch
            else:
                cur = test
        lines.append(cur)
    return lines[:3]


def render_panel(draw: ImageDraw.ImageDraw) -> None:
    """左侧绿色面板，做自上而下的细微渐变。"""
    for y in range(H):
        t = y / max(1, H - 1)
        r = int(GREEN_TOP[0] * (1 - t) + GREEN_BOT[0] * t)
        g = int(GREEN_TOP[1] * (1 - t) + GREEN_BOT[1] * t)
        b = int(GREEN_TOP[2] * (1 - t) + GREEN_BOT[2] * t)
        draw.rectangle([0, y, PANEL_W, y + 1], fill=(r, g, b))


def paste_tree_mark(img: Image.Image, here: str = __file__) -> None:
    """把透明背景的 LIBEREAL 树形品牌标贴到面板左上角。"""
    tree_path = os.path.join(os.path.dirname(here), 'assets', 'libereal-tree-mark.png')
    if not os.path.exists(tree_path):
        return
    tree = Image.open(tree_path).convert('RGBA')
    target_w = 112
    tree = tree.resize((target_w, int(target_w * tree.size[1] / tree.size[0])), Image.LANCZOS)
    img.paste(tree, (48, 36), tree)


def paste_right_image(img: Image.Image, right_path: str | None) -> None:
    """右侧实物图：cover 裁剪到 (660×630)，居中。找不到则纯白兜底。"""
    rw, rh = W - PANEL_W, H
    if not right_path or not os.path.exists(right_path):
        img.paste(Image.new('RGB', (rw, rh), (255, 255, 255)), (PANEL_W, 0))
        return
    ri = Image.open(right_path).convert('RGB')
    src_ratio = ri.size[0] / ri.size[1]
    tgt_ratio = rw / rh
    if src_ratio > tgt_ratio:
        new_w = int(ri.size[1] * tgt_ratio)
        x0 = (ri.size[0] - new_w) // 2
        ri = ri.crop((x0, 0, x0 + new_w, ri.size[1]))
    else:
        new_h = int(ri.size[0] / tgt_ratio)
        y0 = (ri.size[1] - new_h) // 2
        ri = ri.crop((0, y0, ri.size[0], y0 + new_h))
    ri = ri.resize((rw, rh), Image.LANCZOS)
    img.paste(ri, (PANEL_W, 0))


def render(
    brand_cn: str,
    eyebrow: str,
    headline: str,
    subtitle: str,
    right_image: str | None,
    output: str,
    footer: str = 'LIBEREAL · 生物 · 医学科研服务平台',
) -> None:
    """渲染单张 OG 封面到 output（1200×630 JPG）。"""
    img = Image.new('RGB', (W, H), (255, 255, 255))
    paste_right_image(img, right_image)

    draw = ImageDraw.Draw(img)
    render_panel(draw)
    paste_tree_mark(img)

    f_brand = load_font(30)
    f_eyebrow = load_font(22)
    f_head = load_font(58)
    f_sub = load_font(26)
    f_foot = load_font(18)

    # 品牌中文名（在树标下方）
    draw.text((56, 158), brand_cn, font=f_brand, fill=(255, 255, 255))
    # eyebrow
    draw.text((56, 208), eyebrow, font=f_eyebrow, fill=(220, 240, 232))
    # 大标题（最多 3 行）
    lines = wrap_text(draw, headline, f_head, PANEL_W - 100)
    y = 256
    for line in lines:
        draw.text((56, y), line, font=f_head, fill=(255, 255, 255))
        y += 72
    # 副标题
    if subtitle:
        draw.text((56, y + 14), subtitle, font=f_sub, fill=(220, 240, 232))
    # 左下脚注：白色短刻度 + LIBEREAL 字样
    draw.rectangle([56, H - 50, 88, H - 44], fill=(255, 255, 255))
    draw.text((100, H - 58), footer, font=f_foot, fill=(220, 240, 232))

    os.makedirs(os.path.dirname(output) or '.', exist_ok=True)
    img.save(output, 'JPEG', quality=86, optimize=True, progressive=True)


# 内置预设：给当前两个品牌 hub 用。后续新活动加新预设即可。
PRESETS: list[dict[str, Any]] = [
    {
        'brand_cn': 'LABSELECT 甄选',
        'eyebrow': '品牌专场',
        'headline': '细胞培养耗材\n一站式甄选',
        'subtitle': '培养板 · 培养瓶 · 移液器 · 吸头',
        'right_image': 'public/images/promotions/labselect-culture-plates/hero-banner.jpg',
        'output': 'public/images/promotions/share/labselect-og.jpg',
    },
    {
        'brand_cn': 'BIOSHARP 生命科学',
        'eyebrow': '品牌专场',
        'headline': 'WB 分子生物学\n实验室常备',
        'subtitle': '蛋白 Marker · 转印膜 · 检测试剂',
        'right_image': 'public/images/promotions/biosharp-labselect/biosharp-hero-v1.jpg',
        'output': 'public/images/promotions/share/biosharp-og.jpg',
    },
]


def main() -> int:
    parser = argparse.ArgumentParser(description='生成 LIBEREAL 促销 OG 封面（1200×630 JPG）')
    parser.add_argument('--config', help='JSON 配置文件路径（数组，每项对应一张）', default=None)
    parser.add_argument(
        '--project-root',
        default='.',
        help='right_image/output 的相对根目录（默认当前目录，即 libereal 项目根）',
    )
    args = parser.parse_args()

    presets: list[dict[str, Any]] = PRESETS
    if args.config:
        with open(args.config, encoding='utf-8') as fp:
            presets = json.load(fp)

    root = os.path.abspath(args.project_root)
    for cfg in presets:
        right = cfg.get('right_image')
        output = cfg['output']
        render(
            brand_cn=cfg['brand_cn'],
            eyebrow=cfg['eyebrow'],
            headline=cfg['headline'],
            subtitle=cfg.get('subtitle', ''),
            right_image=os.path.join(root, right) if right else None,
            output=os.path.join(root, output),
        )
        size_kb = os.path.getsize(os.path.join(root, output)) // 1024
        print(f"rendered {output}  ({size_kb}KB)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
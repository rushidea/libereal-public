#!/usr/bin/env python3
"""
Cover/illustration watermark script for LIBEREAL WeChat articles.

Usage:
  python3 scripts/cover-watermark.py <input.png> <output.png>
  python3 scripts/cover-watermark.py --batch  # process all *-raw.png in content/wechat/

Covers the AI-generated "图片由AI生成" watermark in the bottom-right corner
with a white FULLY OPAQUE rounded rectangle (alpha=255) containing a single
line: [WeChat icon] LIBEREAL-天放生物.

WeChat only auto-stamps its service-account watermark on the PC client; mobile
client and draft previews show nothing. Drawing our own mark inside the white
block guarantees the brand mark is visible on every platform. The block hides
the AI watermark and carries the brand mark.

Does NOT crop the image (cropping destroys composition).

Requires: Pillow (PIL)
"""

import sys
import os
from PIL import Image, ImageDraw, ImageFont

CONTENT_DIR = os.path.join(os.path.dirname(__file__), '..', 'content', 'wechat')
WECHAT_ICON_PATH = os.path.join(CONTENT_DIR, 'wechat-icon.png')

# Font paths (macOS)
FONT_ZH = '/System/Library/Fonts/Hiragino Sans GB.ttc'

# Brand colors
COLOR_NAME = (107, 114, 128, 255)   # #6b7280 gray for 公众号名称

# Minimum coverage area so the AI watermark is always fully hidden
MIN_W_RATIO = 0.30
MIN_H_RATIO = 0.07

NAME_TEXT = 'LIBEREAL-天放生物'


def load_font(path, size):
    """Load a font, falling back to the PIL default if unavailable."""
    if os.path.exists(path):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    return ImageFont.load_default()


def cover_watermark(raw_path, out_path, icon_path=WECHAT_ICON_PATH):
    """Cover AI watermark (bottom-right) with a white rounded rectangle carrying the brand mark.

    WeChat only auto-stamps its service-account watermark on the PC client;
    mobile client and draft previews show nothing. Drawing our own mark inside
    the white block ([WeChat icon] LIBEREAL-天放生物) guarantees the brand mark
    is visible on every platform while hiding the AI-generated watermark.
    """
    img = Image.open(raw_path).convert('RGBA')
    w, h = img.size

    overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    pad = int(h * 0.015)

    name_font = load_font(FONT_ZH, int(h * 0.038))
    name_bbox = draw.textbbox((0, 0), NAME_TEXT, font=name_font)
    name_tw = name_bbox[2] - name_bbox[0]
    name_th = name_bbox[3] - name_bbox[1]

    icon = Image.open(icon_path).convert('RGBA') if os.path.exists(icon_path) else None
    icon_size = int(name_th * 1.15)
    icon_gap = int(h * 0.012)
    icon_scaled = icon.resize((icon_size, icon_size), Image.LANCZOS) if icon else None

    content_w = (icon_size + icon_gap if icon_scaled else 0) + name_tw
    content_h = max(icon_size, name_th)

    rect_w = max(content_w + pad * 4, int(w * MIN_W_RATIO))
    rect_h = max(content_h + pad * 2, int(h * MIN_H_RATIO))
    rect_x0 = w - rect_w - pad
    rect_x1 = w
    # Anchor the white block to the bottom edge of the image so the AI
    # watermark (which sits flush against the bottom) is always fully covered.
    rect_y1 = h
    rect_y0 = h - rect_h

    draw.rounded_rectangle(
        [rect_x0, rect_y0, rect_x1, rect_y1],
        radius=12,
        fill=(255, 255, 255, 255),
    )

    # Center the icon + text block inside the rectangle
    content_x = rect_x0 + (rect_w - content_w) // 2
    center_y = (rect_y0 + rect_y1) // 2

    if icon_scaled:
        overlay.paste(icon_scaled, (int(content_x), int(center_y - icon_size // 2)), icon_scaled)
        name_x = content_x + icon_size + icon_gap
    else:
        name_x = content_x

    name_y = center_y - name_th // 2 - name_bbox[1]
    draw.text((name_x, name_y), NAME_TEXT, fill=COLOR_NAME, font=name_font)

    result = Image.alpha_composite(img, overlay).convert('RGB')
    result.save(out_path, 'PNG')
    print(f'OK: {out_path} ({result.size})')


def batch_process(content_dir=CONTENT_DIR):
    """Process all *-raw.png files: cover-raw.png -> cover.png, imgN-raw.png -> imgN.png."""
    count = 0
    for fname in sorted(os.listdir(content_dir)):
        if fname.endswith('-raw.png'):
            raw_path = os.path.join(content_dir, fname)
            out_name = fname[:-len('-raw.png')] + '.png'
            out_path = os.path.join(content_dir, out_name)
            cover_watermark(raw_path, out_path)
            count += 1
    print(f'\nProcessed {count} image(s).')


if __name__ == '__main__':
    if len(sys.argv) == 1 or sys.argv[1] == '--batch':
        batch_process()
    elif len(sys.argv) == 3:
        cover_watermark(sys.argv[1], sys.argv[2])
    else:
        print('Usage:')
        print('  python3 scripts/cover-watermark.py <input.png> <output.png>')
        print('  python3 scripts/cover-watermark.py --batch')
        sys.exit(1)

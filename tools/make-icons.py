#!/usr/bin/env python3
"""
產生 PWA 圖示（public/icons/）。需要 Pillow：pip install pillow

用法：
  python3 tools/make-icons.py                       # 暫用圖示：黑底金圈＋「幻」字
  python3 tools/make-icons.py --source GM給的圖.png  # 用正式圖示（建議 512×512 以上的正方形、背景透明或深色）

輸出：icon-192.png、icon-512.png、icon-maskable-512.png（Android 圓形遮罩用，內容縮在安全區）、apple-touch-icon.png（iPhone，180×180）。
色碼對應 src/styles/theme.css 的 --paper、--gold、--gold2（圖片檔無法使用 CSS 變數，這裡是唯一寫死的地方）。
"""
import argparse
import os
import sys
from PIL import Image, ImageDraw, ImageFont

PAPER = (16, 13, 9)      # --paper #100d09
GOLD = (236, 199, 124)   # --gold #ecc77c
GOLD2 = (184, 149, 79)   # --gold2 #b8954f
FONTS = [
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    'C:/Windows/Fonts/msjh.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
]
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')


def placeholder(size, scale):
    """黑底、金色雙圈、中間一個「幻」字。scale = 內容佔畫面的比例（maskable 要縮小）"""
    img = Image.new('RGB', (size, size), PAPER)
    d = ImageDraw.Draw(img)
    c = size / 2
    r = size * scale / 2
    d.ellipse([c - r, c - r, c + r, c + r], outline=GOLD, width=max(2, round(size * 0.025)))
    r2 = r * 0.9
    d.ellipse([c - r2, c - r2, c + r2, c + r2], outline=GOLD2, width=max(1, round(size * 0.008)))
    font = next((ImageFont.truetype(f, int(r * 1.15)) for f in FONTS if os.path.exists(f)), None)
    if font:
        d.text((c, c), '幻', font=font, fill=GOLD, anchor='mm')
    else:  # 找不到中文字型：畫一個菱形代替
        k = r * 0.45
        d.polygon([(c, c - k), (c + k, c), (c, c + k), (c - k, c)], outline=GOLD, width=max(2, round(size * 0.02)))
    return img


def from_source(path, size, scale):
    src = Image.open(path).convert('RGBA')
    box = int(size * scale)
    ratio = min(box / src.width, box / src.height)
    src = src.resize((max(1, round(src.width * ratio)), max(1, round(src.height * ratio))), Image.LANCZOS)
    img = Image.new('RGBA', (size, size), PAPER + (255,))
    img.alpha_composite(src, ((size - src.width) // 2, (size - src.height) // 2))
    return img.convert('RGB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', help='正式圖示檔（png／webp／jpg）')
    a = ap.parse_args()
    if a.source:
        im = Image.open(a.source)
        if min(im.size) < 256:
            print(f'警告：圖片只有 {im.size[0]}×{im.size[1]}，放大後會模糊，建議跟 GM 要 512×512 以上的原圖。', file=sys.stderr)
    make = (lambda s, sc: from_source(a.source, s, sc)) if a.source else placeholder
    os.makedirs(OUT, exist_ok=True)
    for name, size, scale in [('icon-192.png', 192, 0.86), ('icon-512.png', 512, 0.86), ('icon-maskable-512.png', 512, 0.58), ('apple-touch-icon.png', 180, 0.86)]:
        make(size, scale).save(os.path.join(OUT, name), optimize=True)
        print('寫入', name)


if __name__ == '__main__':
    main()

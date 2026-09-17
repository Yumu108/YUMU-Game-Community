#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成 tabBar 图标（4 个 × 常态/选中 = 8 张 PNG）。

为什么用脚本生成而不是直接塞二进制图：
  1. 图标要跟主题色一起改（未选中 #6F6A80 / 选中 #7C5CFF），脚本里改一个常量就全局生效；
  2. 二进制图在 review / diff 里看不见，脚本可读、可复现；
  3. 顺带保证尺寸统一（uni-app 建议 81×81，<40KB）。

⚠️ pages.json 里配了 iconPath 之后，**所有** tabBar 项都必须配，不能只配一半。

用法：
  <venv>/python tools/gen-tabbar-icons.py
输出：
  src/static/tabbar/{home,games,news,mine}[-on].png

实现要点：先在 4 倍尺寸上画（324px）再 LANCZOS 缩到 81px —— PIL 没有抗锯齿的矢量描边，
超采样是拿到平滑边缘最简单可靠的办法。
镂空（门、D-pad、文字行）用 fill=(0,0,0,0) 直接写入，得到**真透明**像素，
这样图标不依赖 tabBar 底色，改主题也不会露馅。
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'src', 'static', 'tabbar'))

SIZE = 81
SS = 4               # 超采样倍率
N = SIZE * SS

OFF = (0x6F, 0x6A, 0x80, 255)   # 未选中：#6F6A80
ON = (0x7C, 0x5C, 0xFF, 255)    # 选中：YUMU 紫
CLEAR = (0, 0, 0, 0)            # 镂空（真透明）


def _canvas():
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def icon_home(d, c):
    """房子：屋顶三角 + 主体，中间抠出一扇门"""
    d.polygon([(N * 0.50, N * 0.10), (N * 0.94, N * 0.47), (N * 0.06, N * 0.47)], fill=c)
    d.rounded_rectangle([N * 0.20, N * 0.44, N * 0.80, N * 0.90], radius=N * 0.06, fill=c)
    # 门
    d.rounded_rectangle([N * 0.41, N * 0.62, N * 0.59, N * 0.90], radius=N * 0.03, fill=CLEAR)


def icon_games(d, c):
    """手柄：圆角机身 + 左侧十字键 + 右侧两个按键（全部镂空）"""
    d.rounded_rectangle([N * 0.06, N * 0.28, N * 0.94, N * 0.74], radius=N * 0.20, fill=c)
    cy = N * 0.51
    # 十字键：一横一竖
    d.rounded_rectangle([N * 0.16, cy - N * 0.045, N * 0.36, cy + N * 0.045], radius=N * 0.03, fill=CLEAR)
    d.rounded_rectangle([N * 0.235, cy - N * 0.12, N * 0.285, cy + N * 0.12], radius=N * 0.03, fill=CLEAR)
    # 两个按键
    d.ellipse([N * 0.60, cy - N * 0.115, N * 0.72, cy + N * 0.005], fill=CLEAR)
    d.ellipse([N * 0.75, cy - N * 0.005, N * 0.87, cy + N * 0.115], fill=CLEAR)


def icon_news(d, c):
    """资讯：文档 + 三条镂空文字行"""
    d.rounded_rectangle([N * 0.16, N * 0.10, N * 0.84, N * 0.90], radius=N * 0.09, fill=c)
    for i, (x0, x1) in enumerate([(0.28, 0.72), (0.28, 0.72), (0.28, 0.58)]):
        y = N * (0.30 + i * 0.17)
        d.rounded_rectangle([N * x0, y, N * x1, y + N * 0.075], radius=N * 0.037, fill=CLEAR)


def icon_mine(d, c):
    """我的：头（圆）+ 肩（药丸）"""
    d.ellipse([N * 0.30, N * 0.10, N * 0.70, N * 0.50], fill=c)
    d.rounded_rectangle([N * 0.14, N * 0.60, N * 0.86, N * 0.92], radius=N * 0.16, fill=c)


ICONS = {'home': icon_home, 'games': icon_games, 'news': icon_news, 'mine': icon_mine}


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, fn in ICONS.items():
        for suffix, color in (('', OFF), ('-on', ON)):
            img, d = _canvas()
            fn(d, color)
            img = img.resize((SIZE, SIZE), Image.LANCZOS)
            p = os.path.join(OUT, f'{name}{suffix}.png')
            img.save(p)
            print(f'  {os.path.relpath(p, os.path.join(HERE, ".."))}  {os.path.getsize(p)}B')
    print(f'✅ 生成完毕：{OUT}')


if __name__ == '__main__':
    main()

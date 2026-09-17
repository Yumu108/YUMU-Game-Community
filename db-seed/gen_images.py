#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
YUMU 社区配图生成器

为「内容富化」种子批量生成：
  · 用户头像     seed_ava_<uid>.jpg   + _t.jpg
  · 帖子封面     seed_post_<pid>.jpg  + _t.jpg
  · 游戏封面     seed_game_<gid>.jpg  + _t.jpg

命名严格对齐前端 utils/img.js 的 thumbUrl 约定：/api/files/x.jpg → /api/files/x_t.jpg
（列表页加载缩略图，详情页加载主图；所以两张都必须存在，否则列表页会先 404 再回退原图。）

数据来源：直接查本机库，保证与已灌入的数据一一对应。
输出：out/uploads/
"""
import os
import random
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

random.seed(20260917)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out', 'uploads')
FONT_BOLD = 'C:/Windows/Fonts/msyhbd.ttc'
FONT_REG = 'C:/Windows/Fonts/msyh.ttc'

MYSQL = ['mysql', '-uroot', '-p123456', '--default-character-set=utf8mb4', '-N', '-B', '-e']

# 板块配色（深→浅渐变两端 + 装饰色）
BOARD_THEME = {
    1: ((26, 46, 106), (14, 116, 144), (129, 180, 255)),    # 攻略心得：深蓝 → 青
    2: ((120, 40, 20), (170, 40, 40), (255, 170, 120)),     # 游戏吐槽：橙红
    3: ((10, 78, 66), (13, 148, 136), (130, 240, 210)),     # 玩家天地：青绿
    4: ((60, 24, 120), (110, 50, 210), (200, 170, 255)),    # 资讯速递：紫
    5: ((120, 26, 78), (200, 45, 120), (255, 170, 210)),    # 二次创作：粉紫
    6: ((40, 52, 74), (70, 90, 118), (170, 190, 215)),      # 其他：灰蓝
}
BOARD_NAME = {1: '攻略心得', 2: '游戏吐槽', 3: '玩家天地', 4: '资讯速递', 5: '二次创作', 6: '其他'}

# 头像调色板（成对，保证和谐）
AVATAR_PAIRS = [
    ((94, 114, 235), (129, 140, 248)), ((16, 185, 129), (52, 211, 153)),
    ((245, 158, 11), (251, 191, 36)), ((239, 68, 68), (248, 113, 113)),
    ((139, 92, 246), (167, 139, 250)), ((14, 165, 233), (56, 189, 248)),
    ((236, 72, 153), (244, 114, 182)), ((20, 184, 166), (45, 212, 191)),
    ((99, 102, 241), (165, 180, 252)), ((217, 119, 6), (245, 158, 11)),
    ((5, 150, 105), (16, 185, 129)), ((124, 58, 237), (139, 92, 246)),
    ((225, 29, 72), (251, 113, 133)), ((2, 132, 199), (14, 165, 233)),
    ((79, 70, 229), (129, 140, 248)), ((180, 83, 9), (217, 119, 6)),
    ((15, 118, 110), (20, 184, 166)), ((162, 28, 175), (192, 38, 211)),
    ((190, 24, 93), (219, 39, 119)), ((3, 105, 161), (2, 132, 199)),
]

# 游戏类型配色
GENRE_COLOR = {
    'RPG': ((76, 29, 149), (139, 92, 246)), 'MOBA': ((154, 52, 18), (249, 115, 22)),
    '射击': ((127, 29, 29), (239, 68, 68)), 'FPS': ((30, 58, 138), (59, 130, 246)),
    '动作': ((136, 19, 55), (236, 72, 153)), '魂类': ((41, 37, 36), (120, 113, 108)),
    '开放世界': ((6, 95, 70), (16, 185, 129)), '策略': ((30, 64, 175), (96, 165, 250)),
    '模拟经营': ((133, 77, 14), (245, 158, 11)), '沙盒': ((22, 101, 52), (74, 222, 128)),
    '竞速': ((194, 65, 12), (251, 146, 60)), '卡牌': ((88, 28, 135), (168, 85, 247)),
    'MMORPG': ((12, 74, 110), (14, 165, 233)), 'ACT': ((131, 24, 67), (244, 63, 94)),
    '塔防': ((55, 48, 163), (129, 140, 248)), '派对': ((190, 24, 93), (244, 114, 182)),
    '非对称': ((68, 64, 60), (168, 162, 158)), '自走棋': ((109, 40, 217), (167, 139, 250)),
    '合作': ((15, 118, 110), (45, 212, 191)), '其他': ((51, 65, 85), (100, 116, 139)),
}


def q(sql):
    """执行查询，返回二维列表。"""
    r = subprocess.run(MYSQL + [sql], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print('SQL 失败:', r.stderr[:300])
        return []
    return [line.split('\t') for line in r.stdout.strip().splitlines() if line.strip()]


def vgrad(size, c1, c2, angle_diag=True):
    """生成渐变底：小图生成后放大，速度快且平滑。"""
    w, h = size
    sw, sh = max(2, w // 40), max(2, h // 40)
    small = Image.new('RGB', (sw, sh))
    px = small.load()
    for y in range(sh):
        for x in range(sw):
            t = ((x / max(1, sw - 1) + y / max(1, sh - 1)) / 2) if angle_diag else (y / max(1, sh - 1))
            px[x, y] = (
                int(c1[0] + (c2[0] - c1[0]) * t),
                int(c1[1] + (c2[1] - c1[1]) * t),
                int(c1[2] + (c2[2] - c1[2]) * t),
            )
    return small.resize(size, Image.BICUBIC)


def draw_avatar(nickname, seed_i):
    """头像：渐变底 + 首字。"""
    c1, c2 = AVATAR_PAIRS[seed_i % len(AVATAR_PAIRS)]
    base = vgrad((240, 240), c1, c2)
    d = ImageDraw.Draw(base, 'RGBA')
    # 装饰：两个半透明圆
    d.ellipse([150, -40, 300, 110], fill=(255, 255, 255, 26))
    d.ellipse([-50, 150, 90, 290], fill=(255, 255, 255, 20))
    ch = (nickname or '游').strip()[:1] or '游'
    font = ImageFont.truetype(FONT_BOLD, 118)
    d.text((120, 122), ch, font=font, fill=(255, 255, 255, 235), anchor='mm')
    return base, base.resize((96, 96), Image.LANCZOS)


def draw_post_cover(pid, board, title):
    """
    帖子封面：板块配色渐变 + 「中心主图形」。

    设计要点：封面实际只在列表页以 86x64 展示（tiny），所以主体必须是「一眼能认出的图形」，
    细碎的小字和装饰在小尺寸下会糊成一片。因此 —— 中心放一个大号主图形，其余全部弱化。
    """
    c1, c2, acc = BOARD_THEME.get(board, BOARD_THEME[6])
    W, H = 800, 500
    base = vgrad((W, H), c1, c2)
    d = ImageDraw.Draw(base, 'RGBA')
    r = random.Random(pid)

    # 背景大色块（很淡，只负责层次）
    for _ in range(3):
        x, y = r.randint(-100, W), r.randint(-100, H)
        s = r.randint(160, 330)
        d.ellipse([x, y, x + s, y + s], fill=(255, 255, 255, r.randint(8, 15)))

    # 中心主图形：圆环 / 三角 / 方框，三种轮换，保证列表页彼此可区分
    cx, cy = W // 2, H // 2
    kind = r.randint(0, 2)
    if kind == 0:
        d.ellipse([cx - 132, cy - 132, cx + 132, cy + 132], outline=(255, 255, 255, 130), width=18)
        d.ellipse([cx - 54, cy - 54, cx + 54, cy + 54], fill=(acc[0], acc[1], acc[2], 165))
    elif kind == 1:
        d.polygon([(cx, cy - 128), (cx - 132, cy + 92), (cx + 132, cy + 92)], fill=(255, 255, 255, 112))
        d.polygon([(cx, cy - 42), (cx - 54, cy + 40), (cx + 54, cy + 40)], fill=(acc[0], acc[1], acc[2], 175))
    else:
        d.rounded_rectangle([cx - 128, cy - 128, cx + 128, cy + 128], radius=30,
                            outline=(255, 255, 255, 130), width=16)
        d.rounded_rectangle([cx - 60, cy - 60, cx + 60, cy + 60], radius=16,
                            fill=(acc[0], acc[1], acc[2], 170))

    # 角落水印（弱化，小尺寸下糊掉也不碍事）
    if r.random() < 0.5:
        d.text((W - 34, H - 38), BOARD_NAME.get(board, ''), font=ImageFont.truetype(FONT_BOLD, 26),
               fill=(255, 255, 255, 95), anchor='ra')
    else:
        d.text((34, 32), BOARD_NAME.get(board, ''), font=ImageFont.truetype(FONT_BOLD, 26),
               fill=(255, 255, 255, 95))
    return base, base.resize((400, 250), Image.LANCZOS)


def draw_game_cover(gid, name, genre):
    """
    游戏封面：宽幅（560x280，约 2:1）。

    为什么是宽幅：Games.vue 的 .g-cover 是 height:120px 的宽幅容器（object-fit:cover），
    而 PostCard 里的游戏小图标只有 16x16。用正方形图会被横向裁成一条 → 只剩字的中间横条。
    所以这里做成宽幅，并把主图案压在「中央偏中」的位置：
      · 宽幅卡片 → 完整显示
      · 16x16 图标 → object-fit:cover 取水平中间 50%，正好落在主图案上
    """
    c1, c2 = GENRE_COLOR.get(genre or '其他', GENRE_COLOR['其他'])
    W, H = 560, 280
    base = vgrad((W, H), c1, c2)
    d = ImageDraw.Draw(base, 'RGBA')
    r = random.Random(gid)
    for _ in range(5):
        x, y = r.randint(-70, W), r.randint(-70, H)
        s = r.randint(50, 180)
        d.ellipse([x, y, x + s, y + s], fill=(255, 255, 255, r.randint(10, 26)))
    cx, cy = W // 2, H // 2
    d.ellipse([cx - 92, cy - 92, cx + 92, cy + 92], fill=(255, 255, 255, 24))
    ch = (name or '游').strip()[:1]
    d.text((cx, cy - 8), ch, font=ImageFont.truetype(FONT_BOLD, 108), fill=(255, 255, 255, 240), anchor='mm')
    label = name if len(name) <= 12 else name[:11] + '…'
    d.text((cx, H - 30), label, font=ImageFont.truetype(FONT_BOLD, 22), fill=(255, 255, 255, 228), anchor='mm')
    return base, base.resize((420, 210), Image.LANCZOS)


def save(img, thumb, fname):
    img.save(os.path.join(OUT, fname + '.jpg'), 'JPEG', quality=84, optimize=True, progressive=True)
    thumb.save(os.path.join(OUT, fname + '_t.jpg'), 'JPEG', quality=78, optimize=True, progressive=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    users = q("SELECT id, nickname FROM yumu_community.user WHERE id BETWEEN 20001 AND 20400 AND deleted=0")
    posts = q("SELECT id, board_id, title FROM yumu_community.post WHERE id >= 200001 AND deleted=0")
    # 只覆盖「现有 18 款 + 本次新增 25 款」；本机 1000 段的历史测试游戏不生成
    games = [g for g in q("SELECT id, name, IFNULL(genre,'') FROM yumu_community.game WHERE deleted=0")
             if int(g[0]) <= 18 or int(g[0]) >= 20001]
    print('待生成：头像 %d / 帖子封面 %d / 游戏封面 %d' % (len(users), len(posts), len(games)))

    files = []
    for i, (uid, nick) in enumerate(users):
        img, th = draw_avatar(nick, i)
        f = 'seed_ava_%s' % uid
        save(img, th, f)
        files += [f + '.jpg', f + '_t.jpg']

    for pid, board, title in posts:
        img, th = draw_post_cover(int(pid), int(board), title)
        f = 'seed_post_%s' % pid
        save(img, th, f)
        files += [f + '.jpg', f + '_t.jpg']

    for gid, name, genre in games:
        # 现有 18 款用 seed_game_100+ 命名（与 SQL 的 UPDATE 对应），新增款用自身 id
        fname = 'seed_game_%d' % (100 + int(gid) - 1) if int(gid) <= 18 else 'seed_game_%s' % gid
        img, th = draw_game_cover(int(gid), name, genre)
        save(img, th, fname)
        files += [fname + '.jpg', fname + '_t.jpg']

    with open(os.path.join(HERE, 'out', 'image-manifest.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(files) + '\n')

    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in files if os.path.exists(os.path.join(OUT, f)))
    print('完成：%d 个文件，共 %.1f MB' % (len(files), total / 1024 / 1024))


if __name__ == '__main__':
    main()

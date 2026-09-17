#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
YUMU 社区「内容富化」种子生成器

输出：out/030-rich-seed.sql —— 幂等可重跑（先清 id 段再插），末尾重算全部计数列。
id 段规划（两边现有数据都不会撞）：
    game         20001+     tag        20001+     announcement 20001+
    user         20001+     post       200001+
批量互动表（reply/likes/favorite/follow/message/notification/sign_in/points_log）用自增，但按
「user_id 或 post_id 落在本次生成的 id 段内」来清理，保证重跑幂等。

用法：python gen_seed.py [--stats]
"""
import os
import random
import sys
import datetime

random.seed(20260917)  # 固定种子：同一次素材 → 同一份数据，便于复现

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
OUT_DIR = os.path.join(HERE, 'out')

from content_core import GAMES, TAGS, ANNOUNCEMENTS          # noqa: E402
from content_users import USERS                               # noqa: E402
from posts_guide_a import POSTS as P_GUIDE_A                  # noqa: E402
from posts_guide_b import POSTS as P_GUIDE_B                  # noqa: E402
from posts_rant import POSTS as P_RANT                        # noqa: E402
from posts_team import POSTS as P_TEAM                        # noqa: E402
from posts_world import GACHA_POSTS as P_GACHA                # noqa: E402
from posts_world import HELP_POSTS as P_HELP                  # noqa: E402
from posts_news import POSTS as P_NEWS                        # noqa: E402
from posts_art_misc import ART_POSTS, MISC_POSTS              # noqa: E402

# ---------------------------------------------------------------------------
# id 段
# ---------------------------------------------------------------------------
GAME_ID0, TAG_ID0, ANN_ID0, USER_ID0, POST_ID0 = 20001, 20001, 20001, 20001, 200001
REPLY_ID0 = 2000001   # 回复显式 id 段（点赞要按回复 id 关联，必须可控）
USER_ID1 = USER_ID0 + 400   # 本批用户 id 上界（清理用）

# ---------------------------------------------------------------------------
# 现有游戏（两边 id 1~18 完全一致），用于「游戏名 → id」映射
# ---------------------------------------------------------------------------
EXISTING_GAMES = [
    "其他游戏", "原神", "王者荣耀", "和平精英", "英雄联盟", "CS2", "永劫无间",
    "蛋仔派对", "第五人格", "崩坏：星穹铁道", "绝区零", "明日方舟", "阴阳师",
    "DOTA2", "APEX英雄", "艾尔登法环", "黑神话：悟空", "塞尔达传说：王国之泪",
]
GAME_NAME_TO_ID = {name: i + 1 for i, name in enumerate(EXISTING_GAMES)}
for i, g in enumerate(GAMES):
    GAME_NAME_TO_ID[g[0]] = GAME_ID0 + i

# 别名：素材里可能写到简称
GAME_ALIAS = {
    "星穹铁道": "崩坏：星穹铁道",
    "崩铁": "崩坏：星穹铁道",
    "王国之泪": "塞尔达传说：王国之泪",
    "塞尔达": "塞尔达传说：王国之泪",
    "黑神话悟空": "黑神话：悟空",
    "怪猎": "怪物猎人：荒野",
    "艾尔登": "艾尔登法环",
    "2077": "赛博朋克2077",
    "地平线5": "极限竞速：地平线5",
    "FF14": "最终幻想14",
    "wow": "魔兽世界",
    "恐惧": "其他游戏",
}


def game_id_of(name):
    if not name:
        return None
    name = GAME_ALIAS.get(name, name)
    return GAME_NAME_TO_ID.get(name)


# ---------------------------------------------------------------------------
# 标签：把素材里用到的全部标签收进来（去重），id 从 20001 起
# ---------------------------------------------------------------------------
ALL_POSTS = (
    [(p, 1) for p in P_GUIDE_A] + [(p, 1) for p in P_GUIDE_B] +
    [(p, 2) for p in P_RANT] +
    # 玩家天地（board 3，2026-09-17 由「组队大厅」更名）三类内容：
    #   组队请求 / 晒欧气抽卡 / 疑难求助与萌新提问
    [(p, 3) for p in P_TEAM] + [(p, 3) for p in P_GACHA] + [(p, 3) for p in P_HELP] +
    [(p, 4) for p in P_NEWS] + [(p, 5) for p in ART_POSTS] +
    [(p, 6) for p in MISC_POSTS]
)

used_tag_names = set()
for p, _b in ALL_POSTS:
    for t in p[3]:
        used_tag_names.add(t)
NEW_TAGS = list(TAGS)
for t in sorted(used_tag_names):
    if t not in NEW_TAGS:
        NEW_TAGS.append(t)
TAG_NAME_TO_ID = {name: TAG_ID0 + i for i, name in enumerate(NEW_TAGS)}

# ---------------------------------------------------------------------------
# 用户：按「常看板块」建立作者池
# ---------------------------------------------------------------------------
USER_ID_BY_INDEX = [USER_ID0 + i for i in range(len(USERS))]
BOARD_AUTHOR_POOL = {b: [] for b in range(1, 7)}
for i, u in enumerate(USERS):
    boards = [int(x) for x in str(u[5]).split(',') if x.strip().isdigit()]
    for b in boards:
        if 1 <= b <= 6:
            BOARD_AUTHOR_POOL[b].append(i)
ALL_USER_IDX = list(range(len(USERS)))

# 各板块的「偶发作者」（非本命板块也会偶尔发帖，让社区更自然）
for b in range(1, 7):
    extra = [i for i in ALL_USER_IDX if i not in BOARD_AUTHOR_POOL[b]]
    random.shuffle(extra)
    BOARD_AUTHOR_POOL[b] = BOARD_AUTHOR_POOL[b] + extra[:max(6, len(extra) // 6)]

# ---------------------------------------------------------------------------
# 日常水帖池（补足篇数 + 增加「真实社区的碎片感」）
# ---------------------------------------------------------------------------
DAILY_POOL = [
    ("今天掉了一个大段，心态崩了", "打了六把输了五把，最后心态炸了直接关游戏。", ["日常", "心态"]),
    ("求推荐一个能玩很久的游戏", "最近有点游戏荒，想要一款内容量大的。", ["求助", "推荐"]),
    ("这游戏的加载速度能不能优化一下", "每次进副本都要等，等得我想睡了。", ["吐槽", "优化"]),
    ("刚打完一个卡了很久的 BOSS，手在抖", "打了三十多次，终于过了，那种感觉没法形容。", ["日常", "心态"]),
    ("有没有人跟我一样，喜欢在游戏里看风景", "什么都不干，就到处走走看看。", ["日常", "闲聊"]),
    ("今天第一次单排吃到鸡，记录一下", "虽然是运气，但还是很开心。", ["日常", "电竞"]),
    ("游戏时长破千小时了", "看了下统计，居然玩了这么久。", ["日常", "情怀"]),
    ("求一个不用动脑的游戏", "下班之后只想放空，有没有推荐。", ["求助", "推荐"]),
    ("新版本上线第一天，服务器就炸了", "排队排了二十分钟，还是没进去。", ["吐槽", "更新"]),
    ("从今天开始练枪，每天半小时", "立个 flag，一个月后来汇报。", ["日常", "电竞", "技巧"]),
    ("玩了一晚上只为了刷一个材料", "感觉得不偿失，但又停不下来。", ["日常", "肝度"]),
    ("有人能解释一下这个机制吗", "看了说明还是不理解为啥会这样。", ["求助", "萌新"]),
    ("今天遇到一个很好的队友", "全程带节奏还教我怎么做，太感动了。", ["日常", "组队"]),
    ("整理了一下我的游戏截图", "翻到了好几年前的老图，有点感慨。", ["日常", "情怀"]),
    ("这个游戏的配乐是真的好听", "单独找出来循环了一晚上。", ["闲聊", "音乐"]),
    ("终于把主线通关了", "剧情结尾有点出乎意料，不剧透了。", ["日常", "剧情"]),
    ("求问这个配置能不能玩", "老电脑了，想看看还有没有救。", ["求助", "装机"]),
    ("今天练成了一个连招，很有成就感", "练了两小时才练顺，值了。", ["日常", "技巧"]),
    ("感觉自己到了天花板了", "怎么打都上不去了，求突破建议。", ["心态", "求助"]),
    ("游戏里第一个认识的朋友上线了", "好久没见，打了个招呼，有点感慨。", ["情感", "杂谈"]),
    ("有没有一起玩的，随便什么都行", "想找个人一起玩，不挑游戏。", ["组队", "招募"]),
    ("买了个新键盘，手感确实不一样", "打字和游戏都舒服多了。", ["外设", "日常"]),
    ("这游戏的更新日志也太长了吧", "看了十分钟还没看完。", ["吐槽", "更新"]),
    ("今天被队友教了一课", "原来这个位置还可以那样打。", ["日常", "电竞"]),
    ("想找一个能安静玩的游戏", "不要竞技的，也不要社交的。", ["求助", "推荐", "闲聊"]),
    ("攒了一个月的资源，终于够抽了", "希望这次能出货。", ["日常", "抽卡"]),
    ("这游戏的剧情是不是要烂尾了", "最近几章明显在赶进度。", ["吐槽", "剧情"]),
    ("第一次玩这类游戏，求个入门指引", "完全不知道该干什么。", ["求助", "萌新", "入门"]),
    ("今天运气不错，连着两把都赢了", "记录一下这个好日子。", ["日常", "电竞"]),
    ("求问怎么提升画面设置", "帧数有点低，想优化一下。", ["求助", "装机", "优化"]),
    ("这个游戏的美术真的强", "每一帧都能截图当壁纸。", ["闲聊", "绘画"]),
    ("今天把存了很久的存档删了", "有点舍不得，但确实不会再玩了。", ["日常", "情怀"]),
    ("有没有适合两个人玩的游戏", "想和室友一起玩。", ["求助", "推荐", "组队"]),
    ("打了三小时，进度条才动了一点", "是我太慢还是设计太肝。", ["吐槽", "肝度"]),
    ("今天在游戏里遇到了现实中的朋友", "太巧了，没想到他也玩这个。", ["日常", "闲聊"]),
    ("这个 BOSS 的设计真的很用心", "每个阶段都有不同的应对方式。", ["闲聊", "攻略"]),
    ("求一个能让我静下心来的游戏", "最近太浮躁了。", ["求助", "推荐", "心态"]),
    ("第一次做视频剪辑，求指点", "剪了个游戏片段，感觉节奏不对。", ["求助", "剪辑", "创作"]),
    ("今天开黑遇到一个声音很好听的人", "结果一开打发现是大师。", ["日常", "组队"]),
    ("游戏里的日常任务能不能简化一点", "每天都要花一小时做日常。", ["吐槽", "日常"]),
]


# ---------------------------------------------------------------------------
# SQL 工具
# ---------------------------------------------------------------------------
def esc(v):
    """转义为 SQL 字面量。"""
    if v is None:
        return 'NULL'
    s = str(v)
    s = s.replace('\\', '\\\\').replace("'", "\\'")
    s = s.replace('\r', '').replace('\n', '\\n')
    return "'" + s + "'"


def esc_or_null(v):
    return 'NULL' if v is None or v == '' else esc(v)


def mins_ago_expr(minutes):
    """用相对时间，保证无论何时导入，社区都「一直在活跃」。"""
    return "DATE_SUB(NOW(), INTERVAL %d MINUTE)" % int(minutes)


def batch_insert(table, cols, rows, chunk=300, ignore=False):
    """多值批量 INSERT，减少文件行数。ignore=True 时加 IGNORE（用于可能重名的表）。"""
    if not rows:
        return ''
    head = "INSERT IGNORE INTO `%s`" % table if ignore else "INSERT INTO `%s`" % table
    out = []
    for i in range(0, len(rows), chunk):
        part = rows[i:i + chunk]
        vals = ',\n  '.join('(' + ','.join(r) + ')' for r in part)
        out.append("%s (%s) VALUES\n  %s;" % (head, ','.join('`%s`' % c for c in cols), vals))
    return '\n'.join(out) + '\n'


# ---------------------------------------------------------------------------
# 1. 生成帖子（含时间、热度）
# ---------------------------------------------------------------------------
def build_posts():
    """返回 [(post_tuple, board_id)]。DAILY_POOL 是 3 元组，这里统一补成 5 元组。"""
    out = list(ALL_POSTS)
    for title, content, tags in DAILY_POOL:
        out.append(((title, content, None, tags, []), 6))
    return out


def gen_post_rows(raw_posts):
    rows = []
    meta = []          # 与 rows 一一对应，供后续回复/点赞使用
    pid = POST_ID0
    # 时间：越靠近现在越密（社区近期更活跃）
    for p, board in raw_posts:
        title, content, game, tags, replies = p[0], p[1], p[2], p[3], p[4]
        gid = game_id_of(game)

        # 作者：优先本命板块
        pool = BOARD_AUTHOR_POOL.get(board) or ALL_USER_IDX
        author_idx = random.choice(pool)
        author_id = USER_ID_BY_INDEX[author_idx]

        # 时间：前 60 天占 55%，前 180 天占 45%
        if random.random() < 0.55:
            m = random.randint(30, 60 * 24 * 60)
        else:
            m = random.randint(60 * 24 * 60, 180 * 24 * 60)

        # 热度：幂律分布，少数爆款
        heat = random.random() ** 2.2
        view = int(60 + heat * 4200 + random.randint(0, 260))
        is_top = 0
        is_essence = 1 if (board == 1 and heat > 0.86 and random.random() < 0.55) else 0

        # 类型：按板块定
        if board == 1:
            ptype = 1 if random.random() < 0.85 else 0
        elif board == 4:
            ptype = 2 if random.random() < 0.85 else 0
        elif board == 6 and random.random() < 0.18:
            ptype = 3
        else:
            ptype = 0

        summary = content.replace('\\n', ' ').replace('\n', ' ')[:78]

        rows.append((
            str(pid),
            str(author_id),
            str(board),
            'NULL' if gid is None else str(gid),
            esc(title),
            esc(content),
            esc(summary),
            esc('/api/files/seed_post_%d.jpg' % pid),
            str(ptype), '0', str(is_top), str(is_essence),
            str(view), '0', '0',
            mins_ago_expr(m), mins_ago_expr(max(1, m - random.randint(0, 240))),
            '0',
        ))
        meta.append({
            'id': pid, 'board': board, 'author': author_id,
            'game': gid, 'tags': tags, 'replies': replies,
            'mins': m, 'heat': heat, 'title': title,
        })
        pid += 1
    return rows, meta


# ---------------------------------------------------------------------------
# 2. 回复 / 点赞 / 收藏 / 关注 / 订阅 / 私信 / 通知 / 签到 / 积分
# ---------------------------------------------------------------------------
EXTRA_REPLIES = [
    "学到了，谢谢分享", "同感，我也遇到过", "先收藏了，有空试试",
    "这个思路不错", "有道理", "感谢，正好需要",
    "我也来说一句：其实还有另一种做法", "顶一下", "楼主用心了",
    "确实是这样", "已加群", "哈哈笑死我了",
    "请问有详细的图吗", "支持一下", "这版本确实这样",
    "我试过，效果不错", "新手看了很受用", "说得对",
    "补充一点：注意别踩这个坑", "路过看看", "已收藏",
    "这个我要试试", "讲得很清楚", "我最近也在研究这个",
    "感谢整理，省了我不少时间", "有点东西", "顶",
    "正好在找这个", "感谢楼主", "写得很好，希望能继续更新",
]


def gen_all(meta):
    reply_rows, reply_meta = [], []
    like_rows = []
    fav_rows, follow_rows, sub_rows, msg_rows, noti_rows = [], [], [], [], []
    sign_rows, plog_rows = [], []

    # ---------- 回复 ----------
    rid = REPLY_ID0
    for m in meta:
        seeds = m['replies'] or []
        n = len(seeds)
        # 高热度帖额外补几条通用回复
        if m['heat'] > 0.65:
            n += random.randint(1, 3)
        elif m['heat'] > 0.35 and random.random() < 0.5:
            n += 1
        chosen = list(seeds)
        while len(chosen) < n:
            chosen.append(random.choice(EXTRA_REPLIES))
        random.shuffle(chosen)

        used = {m['author']}
        floors = []      # 楼层号
        id_in_post = []  # 本帖已生成的回复 id（供楼中楼引用）
        for i, text in enumerate(chosen):
            pool = [x for x in ALL_USER_IDX if USER_ID_BY_INDEX[x] not in used] or ALL_USER_IDX
            uidx = random.choice(pool)
            uid = USER_ID_BY_INDEX[uidx]
            used.add(uid)
            # 回复时间：帖子之后、且离现在更近
            rm = max(3, int(m['mins'] * random.uniform(0.05, 0.85)))
            floor = i + 1
            # 20% 的回复做成楼中楼（reply_to_id 指向本帖更早的一条回复 id）
            reply_to = 'NULL'
            if id_in_post and random.random() < 0.2:
                reply_to = str(random.choice(id_in_post))
            like_c = int(random.random() ** 2 * 14) if random.random() < 0.45 else 0
            reply_rows.append((
                str(rid), str(m['id']), str(uid), esc(text), reply_to, str(floor),
                '0' if random.random() > 0.02 else '1',
                str(like_c), mins_ago_expr(rm), mins_ago_expr(rm),
            ))
            floors.append(floor)
            id_in_post.append(rid)
            reply_meta.append({'id': rid, 'post': m['id'], 'user': uid, 'mins': rm,
                               'likes': like_c, 'text': text})
            rid += 1

    # ---------- 帖子点赞 ----------
    for m in meta:
        cnt = int(m['heat'] * 46 + random.randint(0, 5))
        if cnt <= 0:
            continue
        likers = random.sample(ALL_USER_IDX, min(cnt, len(ALL_USER_IDX)))
        for uidx in likers:
            uid = USER_ID_BY_INDEX[uidx]
            lm = max(1, int(m['mins'] * random.uniform(0.03, 0.9)))
            like_rows.append((str(uid), '1', str(m['id']), mins_ago_expr(lm), mins_ago_expr(lm), '0'))

    # ---------- 回复点赞（target_id 必须是回复 id；同 user 对同回复只点一次）----------
    for rm in reply_meta:
        if rm['likes'] <= 0:
            continue
        for uidx in random.sample(ALL_USER_IDX, min(rm['likes'], len(USERS))):
            uid = USER_ID_BY_INDEX[uidx]
            lm = max(1, int(rm['mins'] * random.uniform(0.2, 0.95)))
            like_rows.append((str(uid), '2', str(rm['id']), mins_ago_expr(lm), mins_ago_expr(lm), '0'))

    # ---------- 收藏 ----------
    for uidx in ALL_USER_IDX:
        uid = USER_ID_BY_INDEX[uidx]
        k = random.randint(0, 22)
        picked = random.sample(meta, min(k, len(meta)))
        for m in picked:
            fm = max(1, int(m['mins'] * random.uniform(0.02, 0.8)))
            fav_rows.append((str(uid), str(m['id']), mins_ago_expr(fm), mins_ago_expr(fm), '0'))

    # ---------- 关注（用户 + 板块）----------
    for uidx in ALL_USER_IDX:
        uid = USER_ID_BY_INDEX[uidx]
        for fidx in random.sample(ALL_USER_IDX, min(random.randint(0, 16), len(USERS))):
            fid = USER_ID_BY_INDEX[fidx]
            if fid == uid:
                continue
            follow_rows.append((str(uid), '1', str(fid), mins_ago_expr(random.randint(60, 180 * 24 * 60)),
                                mins_ago_expr(random.randint(1, 60)), '0'))
        for b in random.sample(range(1, 7), random.randint(1, 3)):
            follow_rows.append((str(uid), '2', str(b), mins_ago_expr(random.randint(60, 180 * 24 * 60)),
                                mins_ago_expr(random.randint(1, 60)), '0'))

    # ---------- 订阅 ----------
    for uidx in ALL_USER_IDX:
        uid = USER_ID_BY_INDEX[uidx]
        if random.random() < 0.55:
            for b in random.sample(range(1, 7), random.randint(1, 2)):
                sub_rows.append((str(uid), '1', str(b), 'NULL',
                                 mins_ago_expr(random.randint(60, 120 * 24 * 60)),
                                 mins_ago_expr(random.randint(1, 60)), '0'))
        if random.random() < 0.25:
            kw = random.choice(['攻略', '新手', '版本', '联机', '抽卡', '配装', '评测'])
            sub_rows.append((str(uid), '2', 'NULL', esc(kw),
                             mins_ago_expr(random.randint(60, 120 * 24 * 60)),
                             mins_ago_expr(random.randint(1, 60)), '0'))

    # ---------- 私信（若干组会话）----------
    chat_topics = [
        ("今晚还打吗", "打，八点见", "好，我先去吃个饭", "行，我等你"),
        ("你那把武器怎么配的", "看下我发的那个帖子，有写", "好，我去看看", "有问题再问我"),
        ("刚看你上线了", "嗯，忙完了", "要不要一起打两把", "来"),
        ("你那个 BOSS 怎么过的", "卡了两小时，多试几次就熟了", "我再试试", "耐心点，别急"),
        ("周末有空吗", "有，想干嘛", "想组织一把", "可以，我叫上几个人"),
        ("你玩这个多久了", "两年多了吧", "厉害，我才刚玩", "慢慢来，有问题问我"),
        ("活动你做完了吗", "还差最后一步", "我也是，那个太难了", "等晚上一起研究下"),
        ("新版本你抽了吗", "抽了，没出货", "我也是，太难了", "算了，攒着吧"),
        ("你段位多少了", "刚上一个大段", "牛啊", "运气好而已"),
        ("之前那个问题解决了吗", "解决了，是设置的问题", "那就好", "谢谢关心"),
        ("在吗", "在的", "问你个事", "说"),
        ("你也玩这个游戏？", "嗯，玩了一段时间了", "太巧了", "有空一起"),
        ("加个好友吧", "好啊，我 ID 发你了", "收到", "通过了"),
        ("你那个视频做得不错", "谢谢，剪了挺久", "点赞了", "感谢支持"),
        ("明天有空一起打本吗", "可以，几点", "晚上吧", "行"),
        ("你攻略写得挺好的", "过奖了，就是想分享一下", "有用，照着做过了", "能帮上就好"),
        ("最近怎么不玩了", "工作忙", "理解", "有空再回来玩"),
        ("你那个角色怎么练的", "就正常练，没特别的方法", "哦哦", "天赋优先升输出技能"),
        ("听说你上分了", "运气好，连赢了几把", "厉害", "你也加油"),
        ("帮我看看这个配置行不行", "感觉还行，就是少个辅助", "那我换个", "试试看"),
    ]
    mid = 0
    for i in range(26):
        a, b = random.sample(ALL_USER_IDX, 2)
        ua, ub = USER_ID_BY_INDEX[a], USER_ID_BY_INDEX[b]
        dialogue = chat_topics[i % len(chat_topics)]
        base = random.randint(60, 40 * 24 * 60)
        for j, text in enumerate(dialogue):
            mid += 1
            mm = max(1, base - j * random.randint(2, 90))
            sender, recv = (ua, ub) if j % 2 == 0 else (ub, ua)
            msg_rows.append((str(sender), str(recv), esc(text),
                             '1' if random.random() < 0.7 else '0',
                             mins_ago_expr(mm), mins_ago_expr(mm), '0'))

    # ---------- 通知（只取最近 30 天内的互动；去重键对齐 uk_noti_merge）----------
    # 注意：notification 唯一键是 (user_id, type, target_id, source_id)，所以 source_id
    # 必须填「触发者 id」（不能是 NULL，否则 NULL 不互冲会产生重复通知）。
    seen = set()
    recent = [rm for rm in reply_meta if rm['mins'] < 30 * 24 * 60]
    random.shuffle(recent)
    for rm in recent:
        if len(noti_rows) >= 420:
            break
        m = next((x for x in meta if x['id'] == rm['post']), None)
        if not m or m['author'] == rm['user']:
            continue
        key = (m['author'], 1, m['id'], rm['user'])
        if key in seen:
            continue
        seen.add(key)
        noti_rows.append((str(m['author']), '1', str(rm['user']), '1', str(m['id']), str(rm['user']),
                          esc((rm['text'] or '')[:60]), '1' if random.random() < 0.5 else '0',
                          mins_ago_expr(rm['mins']), mins_ago_expr(rm['mins']), '0'))
    # 点赞通知（同 user/type/target/source 只一条）
    for m in meta:
        if m['mins'] > 30 * 24 * 60 or random.random() > 0.45:
            continue
        sender = USER_ID_BY_INDEX[random.randrange(len(USERS))]
        if sender == m['author']:
            continue
        key = (m['author'], 2, m['id'], sender)
        if key in seen:
            continue
        seen.add(key)
        tm = max(1, m['mins'] - random.randint(1, 200))
        noti_rows.append((str(m['author']), '2', str(sender), '1', str(m['id']), str(sender),
                          esc('赞了你的帖子：' + m['title'][:30]), '1' if random.random() < 0.4 else '0',
                          mins_ago_expr(tm), mins_ago_expr(tm), '0'))
    # 系统通知（无 target/source，靠 seen 去重）
    for uidx in random.sample(ALL_USER_IDX, 60):
        uid = USER_ID_BY_INDEX[uidx]
        key = (uid, 4, None, None)
        if key in seen:
            continue
        seen.add(key)
        sm = random.randint(60, 60 * 24 * 60)
        noti_rows.append((str(uid), '4', 'NULL', 'NULL', 'NULL', 'NULL',
                          esc(random.choice(['欢迎加入 YUMU 游戏社区，完善个人资料可以获得更多曝光',
                                             '你的帖子已通过审核', '你的账号已绑定邮箱',
                                             '社区活动开始啦，参与即可获得积分'])),
                          '1' if random.random() < 0.45 else '0',
                          mins_ago_expr(sm), mins_ago_expr(sm), '0'))

    # ---------- 签到 ----------
    for uidx in ALL_USER_IDX:
        uid = USER_ID_BY_INDEX[uidx]
        if random.random() > 0.78:
            continue
        days = random.randint(1, 21)
        cont = 1
        for d in range(days):
            # 断签就重置连续天数
            cont = cont + 1 if d > 0 and random.random() < 0.85 else 1
            pts = 5 if cont == 1 else min(20, 5 + cont)
            sign_rows.append((str(uid), "DATE_SUB(CURDATE(), INTERVAL %d DAY)" % d, str(cont), str(pts),
                              mins_ago_expr(60 * 24 * d), mins_ago_expr(60 * 24 * d), '0'))

    return {
        'reply': reply_rows, 'like': like_rows, 'fav': fav_rows, 'follow': follow_rows,
        'sub': sub_rows, 'msg': msg_rows, 'noti': noti_rows, 'sign': sign_rows,
        'reply_meta': reply_meta,
    }


# ---------------------------------------------------------------------------
# 3. 主流程
# ---------------------------------------------------------------------------
def main():
    raw_posts = build_posts()
    post_rows, meta = gen_post_rows(raw_posts)
    stats = gen_all(meta)

    # 计数：把「实际生成的回复数 / 点赞数」写回帖子，保证与明细表一致
    reply_cnt = {}
    for rm in stats['reply_meta']:
        reply_cnt[rm['post']] = reply_cnt.get(rm['post'], 0) + 1
    like_cnt_post, like_cnt_reply = {}, {}
    for r in stats['like']:
        if r[1] == '1':
            like_cnt_post[r[2]] = like_cnt_post.get(r[2], 0) + 1
        else:
            like_cnt_reply[r[2]] = like_cnt_reply.get(r[2], 0) + 1

    fixed_posts = []
    for i, row in enumerate(post_rows):
        pid = meta[i]['id']
        row = list(row)
        row[13] = str(reply_cnt.get(pid, 0))   # reply_count
        row[14] = str(like_cnt_post.get(pid, 0))  # like_count
        fixed_posts.append(tuple(row))

    # ---------- 用户 ----------
    urows = []
    for i, u in enumerate(USERS):
        uid = USER_ID0 + i
        username, nickname, bio, gender, hobbies, boards, level = u
        hb = [x.strip() for x in hobbies.split(',') if x.strip() and game_id_of(x.strip())]
        # 🚨 兜底：素材里若写了游戏库中不存在的名字（如“拳皇”未收录），过滤后 hobbies 会是空串，
        #   个人主页的「个人爱好」就空白了。这里回退到库中必然存在的两款（id 5 / 20005）。
        if not hb:
            hb = [g for g in ('英雄联盟', '我的世界') if game_id_of(g)]
        gids = [str(game_id_of(x)) for x in hb]
        bl = [x.strip() for x in boards.split(',') if x.strip().isdigit()]
        pts = random.randint(30, 140) if level == 1 else (random.randint(160, 680) if level == 2 else random.randint(760, 2400))
        score = pts + random.randint(-40, 220)
        created = random.randint(20 * 24 * 60, 200 * 24 * 60)
        urows.append((
            str(uid), esc(username), esc(nickname), esc('$2a$10$in7Oy94kfg8pbC9Jg.xor..FjJnSQ1IfOKxoYmZrhdT6iBxfsBT9u'),
            'NULL', '0', 'NULL', esc('/api/files/seed_ava_%d.jpg' % uid), str(gender),
            esc(bio), '0', str(pts), 'NULL', mins_ago_expr(created), mins_ago_expr(created), '0',
            esc(','.join(hb)), esc(','.join(bl)), esc(','.join(gids)), str(score), str(level),
        ))

    # 用户角色（普通用户 role_id=1）
    urole_rows = [(str(USER_ID0 + i), '1') for i in range(len(USERS))]

    # 签到积分流水：用签到的累计值
    plog_rows = []
    for i in range(len(USERS)):
        uid = USER_ID0 + i
        n = random.randint(2, 7)
        bal = random.randint(5, 40)
        t = random.randint(60, 120 * 24 * 60)
        for j in range(n):
            t = max(1, t - random.randint(10, 4000))
            delta = random.choice([5, 5, 8, 10, 12, 15, 20, -10, -20])
            bal += delta
            ty = random.choice([1, 1, 2, 3, 4, 4, 6])
            desc = {1: '每日签到', 2: '发布帖子', 3: '发表回复', 4: '帖子被点赞', 6: '兑换消费'}[ty]
            plog_rows.append((str(uid), str(ty), str(delta), str(max(0, bal)), esc(desc),
                              'NULL', mins_ago_expr(t), mins_ago_expr(t), '0'))

    # ---------- 组装 SQL ----------
    W = []
    a = W.append
    a("-- " + "=" * 74)
    a("-- YUMU 社区内容富化种子（030）")
    a("-- 由 db-seed/gen_seed.py 生成，请勿手改；重新生成：python db-seed/gen_seed.py")
    a("-- 幂等：先清掉本脚本生成的 id 段，再插入，可重复执行。")
    a("-- 真实用户与既有内容不受影响（只追加，不清空历史数据）。")
    a("-- " + "=" * 74)
    a("SET NAMES utf8mb4;")
    a("SET FOREIGN_KEY_CHECKS = 0;")
    a("")
    a("-- ---------- 0. 清理本次生成的 id 段（幂等） ----------")
    a("DELETE FROM `likes`        WHERE user_id BETWEEN %d AND %d OR target_id >= %d;" % (USER_ID0, USER_ID1, POST_ID0))
    a("DELETE FROM `reply`        WHERE id >= %d OR post_id >= %d;" % (REPLY_ID0, POST_ID0))
    a("DELETE FROM `favorite`     WHERE user_id BETWEEN %d AND %d OR post_id >= %d;" % (USER_ID0, USER_ID1, POST_ID0))
    a("DELETE FROM `follow`       WHERE user_id BETWEEN %d AND %d;" % (USER_ID0, USER_ID1))
    a("DELETE FROM `subscription` WHERE user_id BETWEEN %d AND %d;" % (USER_ID0, USER_ID1))
    a("DELETE FROM `message`      WHERE from_user_id BETWEEN %d AND %d OR to_user_id BETWEEN %d AND %d;" % (USER_ID0, USER_ID1, USER_ID0, USER_ID1))
    a("DELETE FROM `notification` WHERE user_id BETWEEN %d AND %d;" % (USER_ID0, USER_ID1))
    a("DELETE FROM `sign_in`      WHERE user_id BETWEEN %d AND %d;" % (USER_ID0, USER_ID1))
    a("DELETE FROM `points_log`   WHERE user_id BETWEEN %d AND %d;" % (USER_ID0, USER_ID1))
    a("DELETE FROM `post_tag`     WHERE post_id >= %d;" % POST_ID0)
    a("DELETE FROM `post`         WHERE id >= %d;" % POST_ID0)
    a("DELETE FROM `user_role`    WHERE user_id BETWEEN %d AND %d;" % (USER_ID0, USER_ID1))
    a("DELETE FROM `user`         WHERE id BETWEEN %d AND %d;" % (USER_ID0, USER_ID1))
    a("DELETE FROM `announcement` WHERE id BETWEEN %d AND %d;" % (ANN_ID0, ANN_ID0 + 50))
    a("DELETE FROM `game`         WHERE id BETWEEN %d AND %d;" % (GAME_ID0, GAME_ID0 + 200))
    a("SET FOREIGN_KEY_CHECKS = 1;")
    a("")

    # 游戏
    a("-- ---------- 1. 游戏库扩充（%d 款） ----------" % len(GAMES))
    grows = []
    for i, g in enumerate(GAMES):
        grows.append((str(GAME_ID0 + i), esc(g[0]), esc('/api/files/seed_game_%d.jpg' % (GAME_ID0 + i)),
                      esc(g[1]), esc(g[2]), esc(g[6]), esc(g[3]), esc(g[4]),
                      esc(g[5]), '0', str(30 + i), '0', str(g[7]),
                      "DATE_SUB(NOW(), INTERVAL 200 DAY)", "DATE_SUB(NOW(), INTERVAL 200 DAY)", '0'))
    a(batch_insert('game', ['id', 'name', 'cover', 'platform', 'genre', 'description', 'developer',
                            'publisher', 'release_date', 'post_count', 'sort', 'status', 'is_hot',
                            'created_at', 'updated_at', 'deleted'], grows), )

    # 补封面：给现有 18 款游戏也配上封面（线上原本全为 null）
    a("-- 现有 18 款游戏补封面（原本 cover 全为 null）")
    for i, name in enumerate(EXISTING_GAMES):
        a("UPDATE `game` SET cover = '/api/files/seed_game_%d.jpg' WHERE id = %d AND name = %s;" %
          (100 + i, i + 1, esc(name)))
    a("")

    # 标签（tag 有 uk_name 唯一键：与现有标签重名时 IGNORE 跳过；关联一律按名字查 id）
    a("-- ---------- 2. 标签扩充（%d 个，与已有标签重名的自动跳过） ----------" % len(NEW_TAGS))
    trows = []
    for i, t in enumerate(NEW_TAGS):
        trows.append((str(TAG_ID0 + i), esc(t), '0',
                      "DATE_SUB(NOW(), INTERVAL 200 DAY)", "DATE_SUB(NOW(), INTERVAL 200 DAY)", '0'))
    a(batch_insert('tag', ['id', 'name', 'use_count', 'created_at', 'updated_at', 'deleted'],
                   trows, ignore=True))

    # 用户
    a("-- ---------- 3. 用户（%d 个，密码统一 123456） ----------" % len(USERS))
    for r in urows:
        a("INSERT INTO `user` (`id`,`username`,`nickname`,`password`,`email`,`email_verified`,`phone`,"
          "`avatar`,`gender`,`bio`,`status`,`points`,`last_login_at`,`created_at`,`updated_at`,`deleted`,"
          "`hobbies`,`favorite_board_ids`,`favorite_game_ids`,`activity_score`,`activity_level`) VALUES (%s);"
          % ','.join(r))
    a(batch_insert('user_role', ['user_id', 'role_id'], urole_rows))

    # 帖子
    a("-- ---------- 4. 帖子（%d 篇） ----------" % len(fixed_posts))
    for r in fixed_posts:
        a("INSERT INTO `post` (`id`,`user_id`,`board_id`,`game_id`,`title`,`content`,`summary`,`cover`,"
          "`type`,`status`,`is_top`,`is_essence`,`view_count`,`reply_count`,`like_count`,"
          "`created_at`,`updated_at`,`deleted`) VALUES (%s);" % ','.join(r))

    # post_tag：tag_id 用「按名字查」的子查询，这样无论标签是本次新增还是库里已有都能正确关联
    a("-- ---------- 5. 帖子标签关联（tag_id 按名字查，兼容已有标签） ----------")
    pt_rows = []
    for m in meta:
        seen_t = set()
        tags = [t for t in (m['tags'] or []) if t in TAG_NAME_TO_ID and t not in seen_t]
        random.shuffle(tags)
        for t in tags[:3]:
            if t in seen_t:
                continue
            seen_t.add(t)
            pt_rows.append((str(m['id']), "(SELECT id FROM `tag` WHERE name=%s LIMIT 1)" % esc(t)))
    a(batch_insert('post_tag', ['post_id', 'tag_id'], pt_rows, ignore=True))

    # 回复
    a("-- ---------- 6. 回复（%d 条，显式 id 段 %d+） ----------" % (len(stats['reply']), REPLY_ID0))
    a(batch_insert('reply', ['id', 'post_id', 'user_id', 'content', 'reply_to_id', 'floor', 'status',
                             'like_count', 'created_at', 'updated_at'], stats['reply']))

    # 点赞
    a("-- ---------- 7. 点赞（%d 条） ----------" % len(stats['like']))
    a(batch_insert('likes', ['user_id', 'target_type', 'target_id', 'created_at', 'updated_at', 'deleted'],
                   stats['like'], chunk=400, ignore=True))

    # 收藏
    a("-- ---------- 8. 收藏（%d 条） ----------" % len(stats['fav']))
    a(batch_insert('favorite', ['user_id', 'post_id', 'created_at', 'updated_at', 'deleted'],
                   stats['fav'], ignore=True))

    # 关注
    a("-- ---------- 9. 关注（%d 条） ----------" % len(stats['follow']))
    a(batch_insert('follow', ['user_id', 'follow_type', 'follow_id', 'created_at', 'updated_at', 'deleted'],
                   stats['follow'], ignore=True))

    # 订阅
    a("-- ---------- 10. 订阅（%d 条） ----------" % len(stats['sub']))
    a(batch_insert('subscription', ['user_id', 'sub_type', 'target_id', 'keyword', 'created_at',
                                    'updated_at', 'deleted'], stats['sub'], ignore=True))

    # 私信
    a("-- ---------- 11. 私信（%d 条） ----------" % len(stats['msg']))
    a(batch_insert('message', ['from_user_id', 'to_user_id', 'content', 'is_read', 'created_at',
                               'updated_at', 'deleted'], stats['msg'], ignore=True))

    # 通知
    a("-- ---------- 12. 通知（%d 条，已按唯一键去重） ----------" % len(stats['noti']))
    a(batch_insert('notification', ['user_id', 'type', 'sender_id', 'target_type', 'target_id',
                                    'source_id', 'content', 'is_read', 'created_at', 'updated_at',
                                    'deleted'], stats['noti'], chunk=250, ignore=True))

    # 签到
    a("-- ---------- 13. 签到（%d 条） ----------" % len(stats['sign']))
    a(batch_insert('sign_in', ['user_id', 'sign_date', 'continuous_days', 'points', 'created_at',
                               'updated_at', 'deleted'], stats['sign'], chunk=400, ignore=True))

    # 积分流水
    a("-- ---------- 14. 积分流水（%d 条） ----------" % len(plog_rows))
    a(batch_insert('points_log', ['user_id', 'type', 'delta', 'balance_after', 'description',
                                  'related_id', 'created_at', 'updated_at', 'deleted'], plog_rows, ignore=True))

    # 公告
    a("-- ---------- 15. 公告（%d 条） ----------" % len(ANNOUNCEMENTS))
    # 时间：两条置顶公告最新（公约 2 小时前、评优活动 1 天前），其余按周递减，
    # 保证「is_top DESC, created_at DESC」排序下置顶的第一条就是社区公约。
    ann_minutes = [120, 6 * 24 * 60, 12 * 24 * 60, 24 * 60, 17 * 24 * 60, 22 * 24 * 60]
    for i, (t, c, top) in enumerate(ANNOUNCEMENTS):
        m = ann_minutes[i % len(ann_minutes)]
        a("INSERT INTO `announcement` (`id`,`title`,`content`,`status`,`is_top`,`sort`,`created_by`,"
          "`created_at`,`updated_at`,`deleted`) VALUES (%d, %s, %s, 0, %d, 0, "
          "(SELECT id FROM (SELECT u.id FROM `user` u JOIN `user_role` ur ON ur.user_id=u.id "
          "JOIN `role` r ON r.id=ur.role_id WHERE r.code='ADMIN' LIMIT 1) t), "
          "DATE_SUB(NOW(), INTERVAL %d MINUTE), DATE_SUB(NOW(), INTERVAL %d MINUTE), 0);"
          % (ANN_ID0 + i, esc(t), esc(c), top, m, m))
    a("")

    # 计数列重算
    a("-- ---------- 16. 重算全部计数列（与明细表完全一致） ----------")
    # 🚨 reply_count 必须只算 status=0：与 ReplyServiceImpl.setHidden 口径一致
    #   （隐藏回复 -1 / 恢复 +1）。漏掉 status 过滤会让「卡片上的回复数」比详情页实际多，
    #   且该列还参与热门排序公式（reply_count*3），会连带把排序带偏。
    a("UPDATE `post` p LEFT JOIN (SELECT post_id, COUNT(*) c FROM `reply` WHERE deleted=0 AND status=0 GROUP BY post_id) r ON r.post_id=p.id SET p.reply_count=IFNULL(r.c,0);")
    a("UPDATE `post` p LEFT JOIN (SELECT target_id, COUNT(*) c FROM `likes` WHERE deleted=0 AND target_type=1 GROUP BY target_id) l ON l.target_id=p.id SET p.like_count=IFNULL(l.c,0);")
    a("UPDATE `reply` r LEFT JOIN (SELECT target_id, COUNT(*) c FROM `likes` WHERE deleted=0 AND target_type=2 GROUP BY target_id) l ON l.target_id=r.id SET r.like_count=IFNULL(l.c,0);")
    a("UPDATE `board` b LEFT JOIN (SELECT board_id, COUNT(*) c FROM `post` WHERE deleted=0 AND status=0 GROUP BY board_id) p ON p.board_id=b.id SET b.post_count=IFNULL(p.c,0);")
    a("UPDATE `game` g LEFT JOIN (SELECT game_id, COUNT(*) c FROM `post` WHERE deleted=0 AND status=0 AND game_id IS NOT NULL GROUP BY game_id) p ON p.game_id=g.id SET g.post_count=IFNULL(p.c,0);")
    a("UPDATE `tag` t LEFT JOIN (SELECT tag_id, COUNT(*) c FROM `post_tag` GROUP BY tag_id) pt ON pt.tag_id=t.id SET t.use_count=IFNULL(pt.c,0);")
    a("")
    a("-- 完成：本次新增 %d 游戏 / %d 标签 / %d 用户 / %d 帖子 / %d 回复 / %d 点赞 / %d 收藏 / %d 关注 / %d 私信 / %d 通知 / %d 签到 / %d 积分" % (
        len(GAMES), len(NEW_TAGS), len(USERS), len(fixed_posts), len(stats['reply']), len(stats['like']),
        len(stats['fav']), len(stats['follow']), len(stats['msg']), len(stats['noti']),
        len(stats['sign']), len(plog_rows)))

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, '030-rich-seed.sql')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(W) + '\n')

    print("已生成：%s" % path)
    print("  游戏 %d / 标签 %d / 用户 %d / 帖子 %d" % (len(GAMES), len(NEW_TAGS), len(USERS), len(fixed_posts)))
    print("  回复 %d / 点赞 %d / 收藏 %d / 关注 %d / 订阅 %d" % (
        len(stats['reply']), len(stats['like']), len(stats['fav']), len(stats['follow']), len(stats['sub'])))
    print("  私信 %d / 通知 %d / 签到 %d / 积分 %d / 公告 %d" % (
        len(stats['msg']), len(stats['noti']), len(stats['sign']), len(plog_rows), len(ANNOUNCEMENTS)))
    print("  文件大小 %.1f MB" % (os.path.getsize(path) / 1024 / 1024))
    return path


if __name__ == '__main__':
    main()

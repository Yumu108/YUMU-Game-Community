# -*- coding: utf-8 -*-
"""
把本机库里的游戏 → Steam AppID 做成一份**可信、可复核**的 `steam_appids.py`。

── 为什么不用「自动搜索」当主路径（2026-09-21 实测教训）──────────────
最初版本用 `storesearch` 按中文名自动解析，结果两类错误都很严重：

  · 漏：只狼 / 星露谷 / 泰拉瑞亚 / 文明6 / 空洞骑士 / 荒野大镖客2 ……
        **明明都在 Steam 上**，却报「未搜到」—— 连续请求被 Steam 限流所致。
  · 错：`CS2 → 666220 CS2D`、`蔚蓝 → 4330360 蔚蓝无限`、`巫师3 → 5006530 旧时曲`、
       `群星 → 1175120 群星战纪` —— **同名的别的产品**，相似度还给了 85 分。

第二类最危险：映射错了就会去抓**另一个游戏**的公告，而页面上完全看不出来
（帖子照样有标题有正文，只是内容对不上游戏）。所以主路径改成：

  1. `SEED` —— 人工给定的 game 名 → appid（这批都是知名作，appid 稳定）；
  2. `ALIAS` —— 该游戏在 Steam 上可能显示的**非中文名**（大量海外作品只有英文名，
     只比中文名会把正确条目全判成低分 —— 这正是第一轮 30 条「待确认」的主因）；
  3. `appdetails` 反查 Steam 正式名 → 与「库里的名字 + ALIAS」取最高分核验；
  4. 不在 SEED 里的（国服手游 / 腾讯系 / 任天堂系居多）走 storesearch **兜底**，
     带重试，且低分一律标出来人工确认。

── 用法 ────────────────────────────────────────────────────────
    python db-seed/resolve_steam_appids.py

只读本机库 + 只读 Steam 公开接口，**不写数据库**。

── 判据 ────────────────────────────────────────────────────────
· score=100 完全相等 → 可信
· score=85  前缀/包含于 → 基本可信（如「巫师3：狂猎」vs「巫师 3：狂猎 - 完全版」）
· score<=70 → **必须人工确认**，不写进映射
· 未解析 → 该游戏在 Steam 上没有，留给二期或手工补

⚠️ 沙箱注入了 http(s)_proxy；Steam 接口在代理下可通（与 localhost 不同），
   因此这里不传 --noproxy。
"""
import io
import os
import re
import subprocess
import sys
import time
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PY = os.path.join(HERE, 'steam_appids.py')

STORE_SEARCH = 'https://store.steampowered.com/api/storesearch/'
APP_DETAILS = 'https://store.steampowered.com/api/appdetails'

# 小程序一期是 PC / 主机侧情报；「多平台」里也含大量 Steam 游戏，一起跑。
PLATFORMS = ('PC', '主机', '多平台')

# 库里的占位游戏，不是真实作品，别拿去搜（会被匹配到「特里的其他游戏合集」这种无关结果）。
SKIP_NAMES = {'其他游戏'}

# ── 人工给定的 AppID ─────────────────────────────────────────────
# 键 = 本机库 game.name（必须完全一致）；值 = Steam appid。
# 每条都会被 appdetails 反查核验，**核验不过就会打印出来**，不会静默采信。
SEED = {
    # —— 原本就解析正确的（保留，避免再依赖搜索）——
    'CS2': 730,
    'DOTA2': 570,
    '永劫无间': 1203220,
    '艾尔登法环': 1245620,
    '黑神话：悟空': 2358720,
    '三角洲行动': 2507950,
    '赛博朋克2077': 1091500,
    '双人成行': 1426210,
    '戴森球计划': 1366540,
    '死亡搁浅2': 3280350,
    '极限竞速：地平线5': 1551360,
    '全面战争：三国': 779340,
    '饥荒': 219740,
    '缺氧': 457140,
    '女神异闻录5 皇家版': 1687950,
    '暗喻幻想': 2679460,
    '天国：拯救2': 1771300,
    '仙剑奇侠传': 1546570,
    '铁拳8': 1778820,
    # —— 修正掉第一轮那批错配的 ——
    '只狼：影逝二度': 814380,
    '星露谷物语': 413150,
    '泰拉瑞亚': 105600,
    '怪物猎人：荒野': 2246340,
    '文明6': 289070,
    '最终幻想14': 39210,
    '守望先锋2': 2357570,
    '拳皇15': 1498570,
    '街头霸王6': 1364780,
    '空洞骑士': 367520,
    '空洞骑士：丝之歌': 1030300,
    '哈迪斯': 1145360,
    '蔚蓝': 504230,
    '以撒的结合：忏悔': 250900,
    '巫师3：狂猎': 292030,
    '黑暗之魂3': 374320,
    '荒野大镖客2': 1174180,
    'GTA5': 271590,
    '战神：诸神黄昏': 2322010,
    '上古卷轴5：天际': 489830,
    '生化危机4 重制版': 2050650,
    '对马岛之魂': 2215430,
    '城市：天际线2': 949230,
    '群星': 281990,
    '欧陆风云4': 236850,
    '最终幻想7：重生': 2909400,
    '帝国时代2 决定版': 813780,
}

# ── 英文别名（核验用）─────────────────────────────────────────────
# 大量海外作品在 Steam 上没有中文名，只比中文名会把**正确**的条目判成低分。
# 这里给出「该 appid 在 Steam 上可能显示的名字」，任意一个与反查结果匹配即算通过。
# ⚠️ 只放宽名字比对，**不放宽 appid 本身**：appid 仍以人工给定为准。
ALIAS = {
    'CS2': ['Counter-Strike 2'],
    '只狼：影逝二度': ['Sekiro'],
    '星露谷物语': ['Stardew Valley'],
    '泰拉瑞亚': ['Terraria'],
    '怪物猎人：荒野': ['Monster Hunter Wilds'],
    '文明6': ['Civilization VI', "Sid Meier's Civilization VI"],
    '最终幻想14': ['FINAL FANTASY XIV'],
    '守望先锋2': ['Overwatch'],
    '拳皇15': ['THE KING OF FIGHTERS XV'],
    '街头霸王6': ['Street Fighter 6'],
    '空洞骑士': ['Hollow Knight'],
    '空洞骑士：丝之歌': ['Hollow Knight: Silksong'],
    '哈迪斯': ['Hades'],
    '蔚蓝': ['Celeste'],
    '以撒的结合：忏悔': ['The Binding of Isaac'],
    '黑暗之魂3': ['DARK SOULS III'],
    '荒野大镖客2': ['Red Dead Redemption 2'],
    'GTA5': ['Grand Theft Auto V'],
    '战神：诸神黄昏': ['God of War Ragnarok'],
    '上古卷轴5：天际': ['The Elder Scrolls V: Skyrim'],
    '生化危机4 重制版': ['Resident Evil 4'],
    '对马岛之魂': ['Ghost of Tsushima'],
    '城市：天际线2': ['Cities: Skylines II'],
    '群星': ['Stellaris'],
    '欧陆风云4': ['Europa Universalis IV'],
    '最终幻想7：重生': ['FINAL FANTASY VII REBIRTH'],
    '帝国时代2 决定版': ['Age of Empires II'],
    '艾尔登法环': ['ELDEN RING'],
}

# ® ™ © 这类符号必须去掉 —— 不去掉会让「守望先锋2」vs「《守望先锋®》」判成不匹配。
_PUNCT = re.compile(r'[\s：:·・\-\'’‘“”"《》()（）\[\]【】!！?？,，.。/、®™©]+')


def norm(s):
    """归一化：去标点/空白 → 去变音符号 → 小写。

    去变音符号这一步是必需的：`God of War Ragnarök` 与别名 `God of War Ragnarok`
    只差一个 ö，不处理就会被判成不匹配（实测踩过）。
    """
    s = _PUNCT.sub('', (s or ''))
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return s.lower()


def load_games():
    """从本机库读游戏（只读）。走 mysql CLI，避免引入 PyMySQL 依赖。"""
    sql = (
        "SELECT id,name,platform FROM game WHERE deleted=0 AND status=0 "
        "AND platform IN ('PC','主机','多平台') ORDER BY id;"
    )
    # 密码走 MYSQL_PWD，免得 mysql 把「命令行密码不安全」警告打进 stderr；
    # Windows 上 mysql CLI 的本地化提示可能是 GBK ⇒ errors='replace' 兜底，
    # 否则 text=True 的读取线程会 UnicodeDecodeError（踩过）。
    env = dict(os.environ, MYSQL_PWD='123456')
    out = subprocess.run(
        ['mysql', '-uroot', '--default-character-set=utf8mb4', '-N', '-B',
         'yumu_community', '-e', sql],
        capture_output=True, encoding='utf-8', errors='replace', env=env
    )
    if out.returncode != 0:
        print('读取游戏失败：', (out.stderr or '')[:300])
        sys.exit(1)
    games = []
    for line in (out.stdout or '').splitlines():
        parts = line.split('\t')
        if len(parts) >= 3:
            games.append({'id': int(parts[0]), 'name': parts[1], 'platform': parts[2]})
    return games


def get_json(url, params=None, tries=3):
    """requests + 简单重试。失败返回 None（逐条跳过，不中断整轮）。"""
    import requests
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, params=params, timeout=25)
            if r.status_code == 200:
                return r.json()
            last = 'HTTP %s' % r.status_code
        except Exception as e:
            last = type(e).__name__
        time.sleep(1.2 * (i + 1))   # 退避 —— 限流时给 Steam 喘口气
    print('      （请求失败：%s）' % last)
    return None


def score(a, b):
    """两个名字的相似度（都先归一化）。"""
    x, y = norm(a), norm(b)
    if not x or not y:
        return 0
    if x == y:
        return 100
    if x.startswith(y) or y.startswith(x):
        return 85
    if x in y or y in x:
        return 70
    return 30


def verify(db_name, appid, canonical):
    """核验一个 appid 是不是我们要的游戏：库里名字 + 英文别名 取最高分。"""
    if not canonical:
        return 0
    s = score(db_name, canonical)
    for al in ALIAS.get(db_name, []):
        s = max(s, score(al, canonical))
    return s


def canonical_name(appid):
    """反查 Steam 正式名。cc 先 CN 后 US —— 国区下架的游戏也要能复核出名字。"""
    for cc in ('CN', 'US'):
        d = get_json(APP_DETAILS, {'appids': str(appid), 'cc': cc, 'l': 'schinese'})
        if isinstance(d, dict):
            node = d.get(str(appid)) or {}
            if node.get('success'):
                nm = (node.get('data') or {}).get('name')
                if nm:
                    return nm
    return None


def search_fallback(db_name):
    """SEED 没覆盖时的兜底搜索。取相似度最高者；低分会在报告里标出。"""
    d = get_json(STORE_SEARCH, {'term': db_name, 'cc': 'CN', 'l': 'schinese'})
    if not isinstance(d, dict):
        return None, None, 0
    best = (None, None, 0)
    for it in (d.get('items') or [])[:8]:
        if it.get('type') != 'app' or not it.get('id') or not it.get('name'):
            continue
        s = score(db_name, it['name'])
        if s > best[2]:
            best = (it['id'], it['name'], s)
        if s == 100:
            break
    return best


def main():
    games = [g for g in load_games() if g['name'] not in SKIP_NAMES]
    print('待解析游戏 %d 款（平台：%s）\n' % (len(games), '/'.join(PLATFORMS)))

    trusted, weak, miss = [], [], []
    for g in games:
        name = g['name']
        if name in SEED:
            aid, src = SEED[name], 'SEED'
        else:
            aid, _sname, _sc = search_fallback(name)
            src = 'SEARCH'
            if aid is None:
                miss.append(g)
                print('  ✗ %-16s 未在 Steam 搜到（SEED 未覆盖）' % name)
                time.sleep(0.4)
                continue

        canonical = canonical_name(aid)
        # 采信门槛：SEED 是人工给定的，允许前缀/包含匹配（≥85）；
        # **SEARCH 是机器猜的，必须完全同名（100）才采信** ——
        # 实测假阳性全部来自搜索兜底：「我的世界」匹到《我的世界：地下城：回荡虚空》、
        # 「红色警戒2」匹到《命令与征服：红色警戒2及尤里的复仇》，都是"看着像"就采信。
        min_score = 85 if src == 'SEED' else 100
        if canonical is None:
            rec = {'id': g['id'], 'name': name, 'appid': aid, 'steam': '(反查失败)', 'score': 0}
            weak.append(rec)
            print('  ? %-16s → %-9s 反查失败，需人工确认 [%s]' % (name, aid, src))
        else:
            s = verify(name, aid, canonical)
            rec = {'id': g['id'], 'name': name, 'appid': aid, 'steam': canonical, 'score': s}
            if s >= min_score:
                trusted.append(rec)
                print('  ✓ %-16s → %-9s %-30s [%d] %s' % (name, aid, canonical, s, src))
            else:
                weak.append(rec)
                print('  ? %-16s → %-9s %-30s [%d] ← 未达门槛 %d，需人工确认（%s）'
                      % (name, aid, canonical, s, min_score, src))
        time.sleep(0.3)

    print('\n—— 汇总 ——')
    print('  可信(≥85)：%d   待确认：%d   未解析：%d' % (len(trusted), len(weak), len(miss)))
    if weak:
        print('\n  ⚠️ 下面这些**没有**写进映射，确认后再手工补进 SEED / ALIAS：')
        for r in weak:
            print('     %-16s appid=%-9s steam=%s' % (r['name'], r['appid'], r['steam']))

    write_map(trusted, miss)


def write_map(records, miss):
    records = sorted(records, key=lambda r: r['id'])
    miss_ids = sorted(g['id'] for g in miss)
    L = []
    L.append('# -*- coding: utf-8 -*-')
    L.append('"""')
    L.append('游戏 → Steam AppID 映射（由 db-seed/resolve_steam_appids.py 生成，已逐条核验）。')
    L.append('')
    L.append('🚨 使用约束：')
    L.append('   · key 用 game.id（不用名字）—— 名字将来可能改，id 不会。')
    L.append('   · 只有 appdetails 反查过、且名字核验 ≥85 的才会出现在这里。')
    L.append('     **低分的宁可缺失也不要写进来** —— 写错会去抓别的游戏的公告，')
    L.append('     而且是静默错误（帖子里看不出来）。缺的可以补 SEED/ALIAS 后重跑。')
    L.append('   · 重跑解析脚本会**覆盖**本文件；手工纠正请同时改 SEED。')
    L.append('"""')
    L.append('')
    L.append('# game_id: (游戏名, steam_appid, Steam 正式名)')
    L.append('APPIDS = {')
    for r in records:
        L.append('    %d: (%r, %d, %r),' % (r['id'], r['name'], r['appid'], r['steam']))
    L.append('}')
    L.append('')
    L.append('# 本机库里没解析到 Steam 的游戏 id（国服手游 / 腾讯系 / 任天堂系居多）—— 二期另想办法')
    L.append('UNRESOLVED = %r' % miss_ids)
    L.append('')

    with io.open(OUT_PY, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(L))
    print('已写出 %s（%d 条）' % (OUT_PY, len(records)))


if __name__ == '__main__':
    main()

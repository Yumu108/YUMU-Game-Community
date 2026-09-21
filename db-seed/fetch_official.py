# -*- coding: utf-8 -*-
"""
【一期】从 Steam 抓游戏**官方公告** → DeepSeek 改写成中文资讯帖 → 灌进「资讯速递」板块。

── 产物与去向 ──────────────────────────────────────────────────
· 作者：官方账号 `yumu_official`（id 见 OFFICIAL_UID，昵称「YUMU官方资讯」）
· 板块：board 4「资讯速递」，`type=2`（资讯），`status=0`（正常，直发可见）
· id 段：**100001–199999**（见下面「id 段为什么选这里」）
· 输出：`db-seed/out/official-posts.sql`（可复核）+ 直接灌本机库

── id 段为什么选 100001–199999 ─────────────────────────────────
`gen_seed.py` 的清理语句是 `DELETE FROM post WHERE id >= 200001`（连带 post_tag /
likes.target_id / favorite.post_id / reply.post_id 一起按 `>= 200001` 删）。
如果把官方帖放进 200001+，**下次重跑 gen_seed 会把它们静默清空**。
本机现状：老帖 id 5001–5509、种子帖 200001–200742 —— **100000–199999 整段空闲**。
放这里既不用去改那个精心调过的生成器，也天然不会被它的清理扫到。
（`gen_images.py` 也只按 `id >= 200001` 取帖配图，因此官方帖不会触发多余配图 ——
  封面直接复用 game.cover，与本项目其余图片走同一条 `/api/files/` 通路。）

── 去重（双保险）──────────────────────────────────────────────
① 状态文件 `out/official_seen.json`：记已处理过的 Steam `gid`（快）；
② 库内检查：正文里含该公告 url 的帖子视为已发过（权威，防状态文件被误删后重复发）。

── 用法 ───────────────────────────────────────────────────────
    python db-seed/fetch_official.py --dry-run      # 只打印，不写库（建议先跑这个）
    python db-seed/fetch_official.py                # 抓取并灌库
    python db-seed/fetch_official.py --days 60      # 放宽到 60 天内的公告
    python db-seed/fetch_official.py --games 20001  # 只跑指定 game id（调试）

── 实测要点（都是踩过的）────────────────────────────────────────
· `maxlength=0` 才拿得到**全文**（实测 16018 字符）；不传只给摘要。
· `feed_type=1` 才是**开发者官方公告**；feed_type=0 是 SteamDB / PC Gamer 等媒体，
  而且混着俄语。不按这个过滤会把媒体内容当官方公告发出去。
· `deepseek-flash` 默认带思维链，会把 max_tokens 全吃掉、content 返回空字符串
  （实测 reasoning_tokens=3000 / content=''）。必须传 `thinking:{type:'disabled'}`，
  写法抄自 `backend/.../AiAssistantService.java`（注释记录：reasoning_effort=none 亦可）。
· 官方公告**多为英文**（连黑神话 / 永劫无间 / 戴森球在 Steam 上发的也是英文），所以
  翻译改写是必需步骤，不是锦上添花。
· 官方公告里**大量是没价值的**：封号名单、节日祝福、打折促销 —— 靠 LLM 的 worth 字段筛掉，
  否则资讯页会被「Happy Children's Day」刷屏。
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(HERE, 'out')
SQL_PATH = os.path.join(OUT_DIR, 'official-posts.sql')
SEEN_PATH = os.path.join(OUT_DIR, 'official_seen.json')

sys.path.insert(0, HERE)
from steam_appids import APPIDS  # noqa: E402

# ── 常量 ────────────────────────────────────────────────────────
OFFICIAL_UID = 20142          # 官方账号 user.id（yumu_official / YUMU官方资讯）
OFFICIAL_ID0 = 100001         # 官方帖 id 段起点（见文件头说明）
BOARD_NEWS = 4                # 资讯速递
POST_TYPE_NEWS = 2
DB = 'yumu_community'

DEFAULT_DAYS = 30             # 只取最近 N 天的公告（太老的不算「资讯」）
DEFAULT_PER_GAME = 3
DEFAULT_LIMIT = 20            # 全局单次上限

STEAM_NEWS = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/'


# ==================== 基础设施 ====================
def mysql_env():
    return dict(os.environ, MYSQL_PWD='123456')


def db_rows(sql):
    """执行查询，返回二维列表。mysql CLI 在 Windows 上的本地化输出可能是 GBK ⇒ errors=replace。"""
    out = subprocess.run(
        ['mysql', '-uroot', '--default-character-set=utf8mb4', '-N', '-B', DB, '-e', sql],
        capture_output=True, encoding='utf-8', errors='replace', env=mysql_env()
    )
    if out.returncode != 0:
        raise RuntimeError('查询失败：%s\n%s' % (sql[:120], (out.stderr or '')[:300]))
    return [ln.split('\t') for ln in (out.stdout or '').splitlines() if ln.strip()]


def db_exec_file(path):
    with io.open(path, 'rb') as f:
        out = subprocess.run(
            ['mysql', '-uroot', '--default-character-set=utf8mb4', DB],
            stdin=f, capture_output=True, env=mysql_env()
        )
    if out.returncode != 0:
        raise RuntimeError('灌库失败：%s' % (out.stderr or b'').decode('utf-8', 'replace')[:500])


def load_llm_key():
    """从项目根 .env 读 LLM_API_KEY（该文件已 gitignore，密钥不进仓库）。"""
    env = os.environ.get('LLM_API_KEY')
    if env:
        return env
    p = os.path.join(ROOT, '.env')
    if os.path.exists(p):
        for line in io.open(p, encoding='utf-8'):
            if line.startswith('LLM_API_KEY='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise RuntimeError('没找到 LLM_API_KEY（环境变量或项目根 .env）')


# ==================== Steam ====================
def steam_news(appid, count=30):
    """取某款游戏的新闻列表。maxlength=0 → 正文全文。"""
    import requests
    for i in range(3):
        try:
            r = requests.get(STEAM_NEWS, params={
                'appid': appid, 'count': count, 'maxlength': 0, 'format': 'json'
            }, timeout=30)
            if r.status_code == 200:
                return (r.json().get('appnews') or {}).get('newsitems') or []
        except Exception:
            pass
        time.sleep(1.5 * (i + 1))
    return []


def strip_html(h):
    """Steam 的 contents 是 HTML（还可能是 BBCode），洗成纯文本。"""
    h = h or ''
    h = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', h, flags=re.S | re.I)
    h = re.sub(r'\[/?[^\]]{1,20}\]', ' ', h)              # BBCode
    h = re.sub(r'<br\s*/?>|</p>|</div>|</li>', '\n', h, flags=re.I)
    h = re.sub(r'<li[^>]*>', '· ', h, flags=re.I)
    h = re.sub(r'<[^>]+>', '', h)
    for a, b in (('&nbsp;', ' '), ('&amp;', '&'), ('&quot;', '"'), ('&#39;', "'"),
                 ('&lt;', '<'), ('&gt;', '>'), ('&hellip;', '…'), ('&mdash;', '—')):
        h = h.replace(a, b)
    h = re.sub(r'[ \t\u00a0]{2,}', ' ', h)
    h = re.sub(r'\n{3,}', '\n\n', h)
    return h.strip()


# ==================== LLM 改写 ====================
SYS_PROMPT = (
    '你是游戏社区「YUMU 游戏社区」的资讯编辑，负责把游戏**官方公告**改写成中文资讯帖。\n'
    '只输出一个 JSON 对象（不要输出字段说明、不要重复字段、不要 markdown 代码块），字段如下：\n'
    '{"worth": 布尔, "reason": "判断理由(20字内)", "title": "中文标题(≤28字)", '
    '"summary": "中文摘要(≤70字)", "content": "中文正文(180-450字)"}\n'
    '\n'
    '【worth 判定】\n'
    '- worth=true：版本更新 / 补丁说明(Patch Notes)、新内容预告、重大活动或联动、'
    '重要机制或平衡性调整、赛季更替。\n'
    '- worth=false：纯节日祝福、打折促销、封号名单、抽奖/签到等纯运营活动、'
    '服务器例行维护通知、致谢或招募公告。\n'
    '\n'
    '【写作要求】\n'
    '1. 用中文；标题要点出游戏名与核心变化，不要用「官方公告」这类空词。\n'
    '2. 正文分点陈述游戏玩家真正关心的信息：具体数值、时间、新玩法机制、平衡改动。\n'
    '3. 需要强调时用「」（中文书名号/引号），**禁止 markdown 的 * # - 等符号**（正文不渲染 markdown）。\n'
    '4. 正文最后另起一行，原样写上：信息来源：<给定链接>。\n'
    '5. 只依据给定原文，**不要编造**原文没有的内容；原文没写清楚的就不要写。\n'
    '6. 保留公告里的具体数字（时间、百分比、数量），那是玩家最关心的。'
)


def llm_rewrite(key, game_name, title, body, url):
    import requests
    user = ('游戏：%s\n公告标题：%s\n公告原文：\n%s\n原文链接：%s'
            % (game_name, title, body[:6000], url))
    payload = {
        'model': os.environ.get('LLM_MODEL', 'deepseek-flash'),
        'messages': [{'role': 'system', 'content': SYS_PROMPT},
                     {'role': 'user', 'content': user}],
        'max_tokens': 2000,
        'temperature': 0.4,
        'response_format': {'type': 'json_object'},
        'thinking': {'type': 'disabled'},   # 关思维链，见文件头「实测要点」
    }
    for i in range(3):
        try:
            r = requests.post('https://api.deepseek.com/v1/chat/completions',
                              headers={'Authorization': 'Bearer ' + key,
                                       'Content-Type': 'application/json'},
                              json=payload, timeout=180)
            if r.status_code != 200:
                time.sleep(2 * (i + 1))
                continue
            txt = r.json()['choices'][0]['message'].get('content') or ''
            return json.loads(txt)
        except Exception:
            time.sleep(2 * (i + 1))
    return None


def sanitize_md(s):
    """兜底：万一模型还是写了 markdown 符号，清掉（正文不渲染 markdown，会原样显示星号）。"""
    s = re.sub(r'\*\*(.+?)\*\*', r'「\1」', s or '')
    s = re.sub(r'(?m)^\s*#{1,6}\s*', '', s)
    s = re.sub(r'^\s*[-*]\s+', '· ', s, flags=re.M)
    return s.strip()


# ── 同事件去重（2026-09-21 补）────────────────────────────────────
# 实测：Capcom 对**同一个角色参战**会发两条官方公告 ——
#   [09-08 01:53] 「Check out gameplay for the second Year 4 character, Arjun!」(1078 字符, 玩法预告)
#   [09-07 23:15] 「Arjun brings his cinematic mantra to Street Fighter 6 ...」(8540 字符, 正式公告)
# 两条 gid 不同，所以**靠 gid 去重抓不住**；但 AI 生成的中文标题几乎一样
# （《街头霸王6》第四年第二位角色Arjun… / 街头霸王6新角色Arjun…），发出来就是重复内容。
# ⇒ 用「归一化标题相似度」兜住这一层。
#
# ⚠️ 两条的顺序是**短的在前面**，所以不能用「保留先到的」——否则留下的反而是信息量少的那条。
#    规则：命中重复时**保留正文更长的**（信息量更大）。
#
# 阈值 0.75 —— 用**实测比值**校准出来的，不是拍的：
#   · 真重复（街头霸王6 同一角色 Arjun 的两条公告）      = 0.851 → 应判重 ✓
#   · 「维京传奇」新单位公布 vs DLC三战役前瞻（真不同）    = 0.649 → 应保留 ✓
#   · 怪物猎人 电龙凯祖 vs 古龙炎王龙（真不同）          = 0.621 → 应保留 ✓
#   · 群星 Cygnus 更新 vs 公测更新（真不同）            = 0.533 → 应保留 ✓
# 0.75 在「应判重」与「应保留」之间各留约 0.10 余量。
# ⚠️ 初版取 0.68，离保留侧只差 0.03，太紧 —— 换个措辞就可能误杀真新闻。
# 命中时会打印实际比值，便于日后复核阈值是否仍然合适。
DUP_THRESHOLD = 0.75


def norm_title(s):
    """标题归一化：只留中日韩文字与字母数字，去掉书名号/引号/冒号/空白等一切装饰。"""
    return re.sub(r'[^0-9A-Za-z\u4e00-\u9fff]', '', s or '').lower()


def title_ratio(a, b):
    import difflib
    x, y = norm_title(a), norm_title(b)
    if not x or not y:
        return 0.0
    if x == y or x in y or y in x:
        return 1.0
    return difflib.SequenceMatcher(None, x, y).ratio()


def find_same_event(title, pool):
    """在 pool 里找同事件的条目。

    pool 可以是「本轮已选中的行（dict）」或「库里的标题（str）」；
    返回 (命中项, 比值)；未达阈值时命中项为 None（比值仍返回，便于复核阈值）。
    返回**原对象**而不是标题字符串，这样批内去重时能直接改那一行。
    """
    best_item, best_r = None, 0.0
    for item in pool:
        t = item['title'] if isinstance(item, dict) else item
        r = title_ratio(title, t)
        if r > best_r:
            best_item, best_r = item, r
    return (best_item, best_r) if best_r >= DUP_THRESHOLD else (None, best_r)


def db_official_titles():
    """库里已有的官方帖标题 —— 跨轮次去重（防同一条公告过几天又被当成新的发一遍）。"""
    rows = db_rows("SELECT title FROM post WHERE user_id=%d AND deleted=0;"
                   % OFFICIAL_UID)
    return [r[0] for r in rows if r and r[0]]


# ==================== 主流程 ====================
def load_seen():
    if os.path.exists(SEEN_PATH):
        try:
            with io.open(SEEN_PATH, encoding='utf-8') as f:
                return set(json.load(f))
        except Exception:
            return set()
    return set()


def save_seen(seen):
    os.makedirs(OUT_DIR, exist_ok=True)
    with io.open(SEEN_PATH, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(sorted(seen), f, ensure_ascii=False, indent=0)


def posted_urls_in_db():
    """库里已存在的官方帖正文（用于按 url 去重 —— 防状态文件被删后重复发）。"""
    rows = db_rows("SELECT content FROM post WHERE board_id=%d AND user_id=%d AND deleted=0;"
                   % (BOARD_NEWS, OFFICIAL_UID))
    return '\n'.join(r[0] if r else '' for r in rows)


def next_post_id():
    rows = db_rows("SELECT IFNULL(MAX(id),0) FROM post WHERE id>=%d AND id<200000;" % OFFICIAL_ID0)
    cur = int(rows[0][0]) if rows and rows[0] else 0
    return max(cur + 1, OFFICIAL_ID0)


def q(v):
    """SQL 字符串转义。正文含换行/引号，必须转义反斜杠与单引号。"""
    if v is None:
        return 'NULL'
    s = str(v).replace('\\', '\\\\').replace("'", "\\'")
    return "'" + s + "'"


def collect_candidates(days, per_game, only_games):
    """把所有游戏的官方公告摊平，按发布时间倒序返回。"""
    now = int(time.time())
    floor = now - days * 86400
    cands = []
    for gid, (name, appid, steam_name) in sorted(APPIDS.items()):
        if only_games and gid not in only_games:
            continue
        items = steam_news(appid)
        off = [it for it in items if it.get('feed_type') == 1]
        kept = 0
        for it in sorted(off, key=lambda x: x.get('date') or 0, reverse=True):
            d = it.get('date') or 0
            if d < floor:
                continue
            if kept >= per_game:
                break
            kept += 1
            cands.append({
                'game_id': gid, 'game_name': name, 'appid': appid,
                'gid': str(it.get('gid')), 'title': it.get('title') or '',
                'body': strip_html(it.get('contents')), 'url': it.get('url') or '',
                'date': d,
            })
        print('  %-16s 官方公告 %2d 条 → 近 %d 天取 %d 条' % (name, len(off), days, kept))
        time.sleep(0.3)
    cands.sort(key=lambda c: c['date'], reverse=True)
    return cands


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='只打印，不写库')
    ap.add_argument('--days', type=int, default=DEFAULT_DAYS)
    ap.add_argument('--per-game', type=int, default=DEFAULT_PER_GAME)
    ap.add_argument('--limit', type=int, default=DEFAULT_LIMIT)
    ap.add_argument('--games', type=str, default='', help='逗号分隔的 game id，只跑这些')
    args = ap.parse_args()

    only_games = {int(x) for x in args.games.split(',') if x.strip()} if args.games else set()

    print('=== 1. 抓取 Steam 官方公告（近 %d 天，每款 ≤%d 条）===' % (args.days, args.per_game))
    cands = collect_candidates(args.days, args.per_game, only_games)
    print('  候选合计 %d 条\n' % len(cands))

    seen = load_seen()
    db_content = posted_urls_in_db()
    db_titles = db_official_titles()
    key = load_llm_key()
    print('  库里已有官方帖 %d 篇（用于跨轮次同事件去重）' % len(db_titles))

    print('=== 2. 去重 + 改写（全局上限 %d 篇）===' % args.limit)
    rows, stats = [], {'skip_seen': 0, 'skip_db': 0, 'skip_worth': 0,
                       'skip_dup': 0, 'ok': 0, 'fail': 0}
    for c in cands:
        if len(rows) >= args.limit:
            break
        if c['gid'] in seen:
            stats['skip_seen'] += 1
            continue
        if c['url'] and c['url'] in db_content:
            stats['skip_db'] += 1
            seen.add(c['gid'])
            continue

        r = llm_rewrite(key, c['game_name'], c['title'], c['body'], c['url'])
        if not r:
            stats['fail'] += 1
            print('  ✗ 改写失败：%s / %s' % (c['game_name'], c['title'][:40]))
            continue
        if not r.get('worth'):
            stats['skip_worth'] += 1
            print('  – 判定不发：%s | %s' % (c['game_name'], (r.get('reason') or '')[:40]))
            seen.add(c['gid'])
            continue

        row = {
            'game_id': c['game_id'], 'gid': c['gid'], 'date': c['date'],
            'title': sanitize_md(r.get('title') or c['title'])[:100],
            'summary': sanitize_md(r.get('summary') or '')[:200],
            'content': sanitize_md(r.get('content') or ''),
        }

        # 同事件去重①：本轮已选中 —— 保留**正文更长**的那条（信息量更大）
        dup, ratio = find_same_event(row['title'], rows)
        if dup is not None:
            stats['skip_dup'] += 1
            seen.add(c['gid'])
            if len(row['content']) > len(dup['content']):
                kept, dropped = row['title'], dup['title']
                dup.update(row)
                print('  ⇄ 同事件取更全的（%.2f）：留「%s」，弃「%s」' % (ratio, kept, dropped))
            else:
                print('  – 同事件跳过（%.2f，已有更全的）：%s' % (ratio, row['title']))
            continue

        # 同事件去重②：库里已有 —— 直接跳过（那条公告早前已发过）
        dup_db, dbr = find_same_event(row['title'], db_titles)
        if dup_db is not None:
            stats['skip_dup'] += 1
            seen.add(c['gid'])
            print('  – 库里已有同事件（%.2f）：%s' % (dbr, row['title']))
            continue

        rows.append(row)
        seen.add(c['gid'])
        stats['ok'] += 1
        print('  ✓ [%s] %s' % (c['game_name'], row['title']))

    print('\n  统计：新增 %d | 已处理过 %d | 库内同 url %d | 同事件去重 %d | 判定不发 %d | 失败 %d'
          % (stats['ok'], stats['skip_seen'], stats['skip_db'],
             stats['skip_dup'], stats['skip_worth'], stats['fail']))

    if not rows:
        print('\n没有新内容，结束（状态文件已更新）。')
        if not args.dry_run:
            save_seen(seen)
        return

    # 封面复用 game.cover —— 与本项目其余图片同一条 /api/files/ 通路，不用新传文件
    covers = {r[0]: (r[1] or '') for r in db_rows(
        "SELECT id, cover FROM game WHERE deleted=0;")}

    start = next_post_id()
    print('\n=== 3. 生成 SQL（id 从 %d 起）===' % start)
    L = ['-- 官方公告资讯帖（由 db-seed/fetch_official.py 生成，勿手工编辑）',
         'SET NAMES utf8mb4;', '']
    for i, r in enumerate(rows):
        pid = start + i
        cover = covers.get(str(r['game_id'])) or covers.get(r['game_id']) or ''
        # 🚨 必须是 INSERT IGNORE：这份 SQL 是要**手工 scp 到线上再灌**的产物
        #   （db-seed/out/ 被 .gitignore 忽略，deploy-local.sh 不会自动带上去）。
        #   重发一次就撞主键 → 整份脚本在第 1 条报 ERROR 1062 中止，后面 19 条全灌不进去，
        #   而且因为 mysql 非事务性 DDL 语境，前面已插的那条留在库里 ⇒ 半死不活状态。
        #   项目里所有 seed 产物（gen_seed.py 的 030-rich-seed.sql 同理）都按幂等写。
        L.append(
            "INSERT IGNORE INTO `post` (`id`,`user_id`,`board_id`,`game_id`,`title`,`content`,`summary`,"
            "`cover`,`type`,`status`,`is_top`,`is_essence`,`view_count`,`reply_count`,`like_count`,"
            "`created_at`,`updated_at`,`deleted`) VALUES (%d,%d,%d,%d,%s,%s,%s,%s,%d,0,1,1,0,0,0,"
            "FROM_UNIXTIME(%d),FROM_UNIXTIME(%d),0);"
            % (pid, OFFICIAL_UID, BOARD_NEWS, r['game_id'], q(r['title']), q(r['content']),
               q(r['summary']), q(cover), POST_TYPE_NEWS, r['date'], r['date']))
    # ↑ status=0（直发可见）· is_top=1（置顶）· is_essence=1（精华）
    #   官方资讯帖默认置顶 + 加精（产品口径，2026-09-21）：
    #   资讯页现在是「资讯速递」板块全量，官方帖靠 置顶+精华+官方角标 三重标识凸显，
    #   而不是独占整个页面。这两个字段是**落库**的 ——
    #   `PostServiceImpl.pagePostsByGame` / `pagePosts` 的 ORDER BY 都以 is_top 打头，
    #   前端 `guideQuery.cmpLatest` 同样把 isTop 排首位，所以置顶两端都自动生效。
    # 计数列重算（与 gen_seed 同口径：deleted=0 AND status=0）
    L.append('')
    L.append("UPDATE `board` b LEFT JOIN (SELECT board_id, COUNT(*) c FROM `post` "
             "WHERE deleted=0 AND status=0 GROUP BY board_id) p ON p.board_id=b.id "
             "SET b.post_count=IFNULL(p.c,0);")
    L.append("UPDATE `game` g LEFT JOIN (SELECT game_id, COUNT(*) c FROM `post` "
             "WHERE deleted=0 AND status=0 GROUP BY game_id) p ON p.game_id=g.id "
             "SET g.post_count=IFNULL(p.c,0);")
    L.append('')

    os.makedirs(OUT_DIR, exist_ok=True)
    with io.open(SQL_PATH, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(L))
    print('  已写出 %s（%d 条 INSERT）' % (SQL_PATH, len(rows)))

    if args.dry_run:
        print('\n[dry-run] 没有灌库。内容预览：')
        for r in rows[:3]:
            print('\n—— %s ——' % r['title'])
            print((r['content'] or '')[:300])
        return

    print('\n=== 4. 灌库 ===')
    db_exec_file(SQL_PATH)
    save_seen(seen)
    print('  完成：新增 %d 篇官方资讯帖（作者 uid=%d，板块 %d）' % (len(rows), OFFICIAL_UID, BOARD_NEWS))


if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
"""【二期】从国内手游官网抓官方公告 → DeepSeek 改写 → 灌「资讯速递」板块。

── 与一期（fetch_official.py）的关系 ──────────────────────────────
改写提示词、worth 判定、同事件去重、SQL 生成、计数重算、落库方式
**全部直接 import 一期的实现**（见下面 `from fetch_official import ...`），
本文件只负责「抓取源」这一层不同：一期走 Steam 开放 API，二期走米哈游官网 JSON。

⇒ 想同时维护两期内容：先 `fetch_official.py`，再 `fetch_mobile.py` 即可。
   两者共用同一条官方账号（uid 20142）与同一个 id 段（100001–199999），
   `next_post_id()` 读库内最大值递增，串行执行不会撞主键。

── 产物与去向 ──────────────────────────────────────────────────
· 作者：官方账号 `YUMU官方资讯`（uid 见 OFFICIAL_UID）
· 板块：board 4「资讯速递」，`type=2`，`status=0`（直发可见），`is_top=1` + `is_essence=1`
· 输出：`db-seed/out/mobile-posts.sql`（可复核）+ 直接灌本机库
· 状态：`db-seed/out/mobile_seen.json`（记已处理过的 `<key前缀>:<iInfoId>`）

── 去重（三保险，与一期同思路）──────────────────────────────────
① 状态文件 `mobile_seen.json`：按公告 id 记（快）；
② 库内正文含该公告 url ⇒ 视为已发（防状态文件被误删后重复发）；
③ 同事件标题相似度（`find_same_event`，阈值 0.75）——既与本轮已选比，
   也与**库里已有官方帖标题**比 ⇒ 顺带挡住「Steam 一期已发过同一事件」。

── 用法 ───────────────────────────────────────────────────────
    python db-seed/fetch_mobile.py --dry-run        # 只打印，不写库（建议先跑）
    python db-seed/fetch_mobile.py                  # 抓取并灌库
    python db-seed/fetch_mobile.py --days 90        # 放宽到 90 天内
    python db-seed/fetch_mobile.py --games 2        # 只跑指定 game id（调试）
    python db-seed/mobile_sources.py                # 只探活：各源 iTotal + 最新标题

── 人工核对（上线前必做一步）────────────────────────────────────
详情页是**客户端渲染**，curl 只能拿到 SPA 壳 ⇒ **拼出来的来源链接无法自动验证**。
灌库后请人工点开任意一条帖的「信息来源：…」确认能落到公告页；
若站点路由变了，改 `mobile_sources.py` 里该游戏的 `detail` 模板即可。
"""
import argparse
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from mobile_sources import SOURCES, fetch_channel, detail_url            # noqa: E402
from fetch_official import (                                             # noqa: E402
    OUT_DIR, OFFICIAL_UID, BOARD_NEWS, POST_TYPE_NEWS,
    db_rows, db_exec_file, load_llm_key, strip_html, llm_rewrite, sanitize_md,
    find_same_event, q, next_post_id, db_official_titles, posted_urls_in_db,
)

SQL_PATH = os.path.join(OUT_DIR, 'mobile-posts.sql')
SEEN_PATH = os.path.join(OUT_DIR, 'mobile_seen.json')

DEFAULT_DAYS = 45
DEFAULT_PER_GAME = 6      # 比一期宽：手游官网里「不值得发」的比例更高（生日祝福/概率公示）
DEFAULT_LIMIT = 20        # 与一期一致的全局单次上限


def parse_dt(s):
    """`2026-09-21 10:45:11` → epoch 秒；解析失败返回 0。"""
    try:
        return int(time.mktime(time.strptime((s or '').strip(), '%Y-%m-%d %H:%M:%S')))
    except Exception:
        return 0


def source_tag(src):
    """给公告 id 加游戏前缀，避免跨游戏撞号（虽然 iInfoId 实测全局唯一）。"""
    return (src.get('key') or 'x')[:8]


def load_seen():
    import json
    import io
    if os.path.exists(SEEN_PATH):
        try:
            with io.open(SEEN_PATH, encoding='utf-8') as f:
                return set(json.load(f))
        except Exception:
            return set()
    return set()


def save_seen(seen):
    import json
    import io
    os.makedirs(OUT_DIR, exist_ok=True)
    with io.open(SEEN_PATH, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(sorted(seen), f, ensure_ascii=False, indent=0)


def collect_candidates(days, per_game, only_games):
    """把所有源的公告摊平，按发布时间倒序返回（同游戏内多频道按 iInfoId 去重）。"""
    floor = int(time.time()) - days * 86400
    cands = []
    for gid in sorted(SOURCES):
        src = SOURCES[gid]
        if only_games and gid not in only_games:
            continue
        items, seen_ids = [], set()
        for ch in src['channels']:
            got = fetch_channel(src, ch, page_size=50)
            for it in got:
                iid = str(it.get('iInfoId') or '')
                if not iid or iid in seen_ids:
                    continue
                seen_ids.add(iid)
                items.append(it)
            time.sleep(0.3)

        fresh = [(parse_dt(it.get('dtCreateTime')), it) for it in items]
        fresh = [(d, it) for d, it in fresh if d and d >= floor]
        fresh.sort(key=lambda x: -x[0])

        kept = 0
        for d, it in fresh:
            if kept >= per_game:
                break
            kept += 1
            iid = str(it.get('iInfoId'))
            cands.append({
                'game_id': gid, 'game_name': src['game'],
                'gid': '%s:%s' % (source_tag(src), iid),
                'title': it.get('sTitle') or '',
                'body': strip_html(it.get('sContent')),
                'url': detail_url(src, iid),
                'date': int(d),
            })
        print('  %-14s 抓 %3d 条 → 近 %d 天 %2d 条 → 取 %d 条'
              % (src['game'], len(items), days, len(fresh), kept))

    cands.sort(key=lambda c: -c['date'])
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

    print('=== 1. 抓国内手游官网公告（近 %d 天，每款 ≤%d 条）===' % (args.days, args.per_game))
    cands = collect_candidates(args.days, args.per_game, only_games)
    print('  候选合计 %d 条\n' % len(cands))
    if not cands:
        print('没有候选（接口失效？先跑 python db-seed/mobile_sources.py 探活）')
        return

    seen = load_seen()
    db_content = posted_urls_in_db()
    db_titles = db_official_titles()
    key = load_llm_key()
    print('  库里已有官方帖 %d 篇（用于跨轮次 / 跨来源同事件去重）' % len(db_titles))

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

        # 同事件去重①：本轮已选中 —— 保留正文更长的那条
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

        # 同事件去重②：库里已有（含一期 Steam 发过的同一事件）
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

    covers = {r[0]: (r[1] or '') for r in db_rows("SELECT id, cover FROM game WHERE deleted=0;")}

    start = next_post_id()
    print('\n=== 3. 生成 SQL（id 从 %d 起）===' % start)
    L = ['-- 官方公告资讯帖·国内手游官网（由 db-seed/fetch_mobile.py 生成，勿手工编辑）',
         'SET NAMES utf8mb4;', '']
    for i, r in enumerate(rows):
        pid = start + i
        cover = covers.get(str(r['game_id'])) or covers.get(r['game_id']) or ''
        # INSERT IGNORE 的理由同一期：产物要手工 scp 到线上重灌，必须幂等
        L.append(
            "INSERT IGNORE INTO `post` (`id`,`user_id`,`board_id`,`game_id`,`title`,`content`,`summary`,"
            "`cover`,`type`,`status`,`is_top`,`is_essence`,`view_count`,`reply_count`,`like_count`,"
            "`created_at`,`updated_at`,`deleted`) VALUES (%d,%d,%d,%d,%s,%s,%s,%s,%d,0,1,1,0,0,0,"
            "FROM_UNIXTIME(%d),FROM_UNIXTIME(%d),0);"
            % (pid, OFFICIAL_UID, BOARD_NEWS, r['game_id'], q(r['title']), q(r['content']),
               q(r['summary']), q(cover), POST_TYPE_NEWS, r['date'], r['date']))
    L.append('')
    L.append("UPDATE `board` b LEFT JOIN (SELECT board_id, COUNT(*) c FROM `post` "
             "WHERE deleted=0 AND status=0 GROUP BY board_id) p ON p.board_id=b.id "
             "SET b.post_count=IFNULL(p.c,0);")
    L.append("UPDATE `game` g LEFT JOIN (SELECT game_id, COUNT(*) c FROM `post` "
             "WHERE deleted=0 AND status=0 GROUP BY game_id) p ON p.game_id=g.id "
             "SET g.post_count=IFNULL(p.c,0);")
    L.append('')

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(SQL_PATH, 'w', encoding='utf-8', newline='\n') as f:
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

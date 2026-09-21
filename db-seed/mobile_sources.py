# -*- coding: utf-8 -*-
"""【二期】国内手游官网的公告接口配置（米哈游 content_v2 系）。

── 为什么是这个接口 ──────────────────────────────────────────────
一期（`fetch_official.py`）走 Steam 的开放 API；二期按用户口径补「国内手游官网」。
国内厂商里，米哈游旗下四款主力（原神 / 崩坏：星穹铁道 / 绝区零 / 崩坏3）
的**官网新闻页共用同一套前后端接口**，实测可直连、返回结构化 JSON，
且覆盖了库内最热的一批手游（原神 id=2、崩铁 id=10、绝区零 id=11）。

── 接口形态（实测 2026-09-21）────────────────────────────────────
    GET {host}/app/{key}/getContentList
        ?iAppId={app_id}&iChanId={channel}&iPageSize={n}&iPage={p}&sLangKey=zh-cn
    返回 {"retcode":0,"data":{"iTotal":N,"list":[ ... ]}}，单条字段：
        iInfoId       166237        公告唯一 id（去重键；也出现在配图 URL 路径里）
        sTitle        7.1版本更新维护预告
        sContent      "<p style=...>"  正文 HTML（含 <img>，需 strip_html 洗）
        dtCreateTime  2026-09-21 10:45:11   发布时间（→ 帖子的 created_at）
        sUrl          ""             ⚠️ 实测为空 ⇒ 来源链接必须自己拼（见 detail）
    个别游戏不校验 iAppId，带上也无害。

── 🚨 这些 KEY 是从**站点前端 bundle 里挖出来的**，不是文档化开放 API ──
换游戏大版本时，页面重构可能导致 KEY / 频道号失效（表现：`retcode != 0`
或 `data.list` 为空）。**复现排查办法**（本期就是这么找到的）：
  1. 打开该游戏官网的新闻路由，例如 `https://sr.mihoyo.com/main/news`；
  2. 取出页面里的 `/_nuxt/*.js`，逐个下载；
  3. 在其中 `grep -o '.\\{0,200\\}content_v2_user.\\{0,300\\}'`：
     · `"...content_v2_user/app/<KEY>"` 里的就是 KEY；
     · 紧随其后的 `{NEWS:{...},NOTICE:...}` 常量表给出**频道号**。
  脚本化版本见 git 历史里的临时探测脚本（`.probe/find_key.py`，已删）。
  另外 2026-09-21 亲历：原神旧主机 `content-static.mihoyo.com` **已整体下线**
  （AliDNS 都是 NXDOMAIN），现行主机是 `act-api-takumi-static`。

── 各源说明 ──────────────────────────────────────────────────────
· 原神：`act-api-takumi-static` + key 16471662a82d418a，iAppId=43。
  频道 NEWS{TOP_GRID:723, LATEST:719, NOTICE:721}；实测 iChanId=721 → iTotal=153。
· 崩铁：同主机 + key 1963de8dc19e461c。频道表 NEWS_ALL:255, NEWS:256, NOTICE:257,
  ACTIVITY:258, NEWS_BANNER:260, TAB_LIST:261, WORLD_LIST:259, CHARACTERS:253,
  HOME:101956, GACHA_ID:112426；实测 iChanId=256 → iTotal=318。
· 绝区零：主机**不同**（`api-takumi-static`，无 act- 前缀）+ key 706fd13a87294881。
  频道 NEWS{ALL:273, NEWS:278, ANNOUNCE:279, EVENT:280} + VERSION_INFO:783；
  实测 273→1596 / 278→1119 / 279→465 / 280→12 / 783→1。
· 崩坏3：官网走的是另一套 puzzle 模板（`act.mihoyo.com/puzzle/bh3/...`），
  **本期未纳入** —— 需要另写适配器，留待后续。
"""

HOST_ACT = 'https://act-api-takumi-static.mihoyo.com'
HOST_API = 'https://api-takumi-static.mihoyo.com'

# game_id（对应库里 `game.id`）→ 源配置
SOURCES = {
    2: {
        'game': '原神',
        'vendor': '米哈游',
        'host': HOST_ACT,
        'key': '16471662a82d418a',
        'app_id': 43,
        # NEWS.NOTICE(721) 是版本/维护/活动公告；LATEST(719)、TOP_GRID(723) 与本频道大量重合
        'channels': [721],
        'referer': 'https://ys.mihoyo.com/',
        'site': 'https://ys.mihoyo.com/main/news',
        # 站点路由是 `/news/detail/:id`（bundle 里 path:"/news/detail/:id?"），
        # 且 iInfoId 与配图 URL 中的 content id 一致 ⇒ 详情页可这样拼。
        # ⚠️ 详情页是客户端渲染，curl 只能拿到 SPA 壳，**无法用 HTTP 状态码自证**，
        #    上线前请人工点一次核对（见 fetch_mobile.py 文件头「人工核对」）。
        'detail': 'https://ys.mihoyo.com/main/news/detail/%s',
    },
    10: {
        'game': '崩坏：星穹铁道',
        'vendor': '米哈游',
        'host': HOST_ACT,
        'key': '1963de8dc19e461c',
        'app_id': None,           # 实测不校验
        'channels': [256, 257],   # NEWS(256) 版本/活动资讯 + NOTICE(257) 公告
        'referer': 'https://sr.mihoyo.com/',
        'site': 'https://sr.mihoyo.com/main/news',
        'detail': 'https://sr.mihoyo.com/main/news/detail/%s',
    },
    11: {
        'game': '绝区零',
        'vendor': '米哈游',
        'host': HOST_API,         # ⚠️ 与另两款不同：没有 act- 前缀
        'key': '706fd13a87294881',
        'app_id': None,
        # ANNOUNCE(279) 公告。⚠️ 实测 **NEWS(278) 与 EVENT(280) 已停更**
        #   （280 里最新一条是 2024-12-17，278 首条是「生日快乐」类运营内容）
        #   ⇒ 只留 279，避免白跑请求 + 把生日祝福类内容灌给 LLM 浪费调用。
        'channels': [279],
        'referer': 'https://zzz.mihoyo.com/',
        'site': 'https://zzz.mihoyo.com/main/news',
        'detail': 'https://zzz.mihoyo.com/main/news/detail/%s',
    },
}

API_PATH = '/content_v2_user/app/%s/getContentList'


def api_url(src):
    """拼出该源的列表接口地址（不含查询串）。"""
    return src['host'] + (API_PATH % src['key'])


def detail_url(src, info_id):
    """该公告的详情页链接。API 的 `sUrl` 实测为空，所以按站点路由模板拼。"""
    tpl = src.get('detail')
    return (tpl % info_id) if (tpl and info_id) else src.get('site', '')


def fetch_channel(src, channel, page_size=30, page=1, timeout=25):
    """拉一个频道的公告列表；失败返回 []（调用方决定是否重试）。

    注意：`iPageSize` 上限实测可到 100；`sLangKey=zh-cn` 决定返回简中。
    """
    import requests
    params = {
        'iChanId': channel,
        'iPageSize': page_size,
        'iPage': page,
        'sLangKey': 'zh-cn',
    }
    if src.get('app_id'):
        params['iAppId'] = src['app_id']
    try:
        r = requests.get(api_url(src), params=params, timeout=timeout,
                         headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                                  'Referer': src.get('referer') or src.get('site', '')})
        if r.status_code != 200:
            return []
        j = r.json()
        if j.get('retcode') != 0:
            return []
        return ((j.get('data') or {}).get('list')) or []
    except Exception:
        return []


def _selfcheck():
    """`python db-seed/mobile_sources.py` —— 逐个源探活，打印 iTotal 与最新一条标题。

    用途：接口失效时的**第一诊断命令**（比跑整条管线快得多）。
    ⚠️ 返回的 list **不按时间排序**（实测 257 频道首条是 2023 年的、而最新的是 2026 年），
       所以这里自己按 dtCreateTime 排一遍再取第一条 —— 否则会误判「这个源停更了」。
    """
    import time as _t

    def _ts(it):
        try:
            return _t.mktime(_t.strptime((it.get('dtCreateTime') or '').strip(),
                                         '%Y-%m-%d %H:%M:%S'))
        except Exception:
            return 0

    for gid in sorted(SOURCES):
        src = SOURCES[gid]
        print('— [game %d] %s（%s）key=%s' % (gid, src['game'], src['vendor'], src['key']))
        for ch in src['channels']:
            lst = fetch_channel(src, ch, page_size=100)
            if not lst:
                print('    ✗ chan %-4s 拿不到数据（KEY/频道号可能已失效，见文件头排查办法）' % ch)
                continue
            newest = sorted(lst, key=_ts, reverse=True)[0]
            print('    ✓ chan %-4s n=%-4d 最新：%s  (%s)  id=%s'
                  % (ch, len(lst), (newest.get('sTitle') or '')[:40],
                     newest.get('dtCreateTime') or '?', newest.get('iInfoId')))
        print('    来源页 %s' % src.get('site', ''))


if __name__ == '__main__':
    _selfcheck()

/**
 * 分类展示的**纯逻辑层** —— 筛选 / 排序 / 计数 / 相关推荐。
 *
 * ── 为什么要单独一个文件（而不是放 guideIndex.js 里）────────────────
 * 这一层**刻意不 import 任何东西**：
 *   · `api/config.js` 用了 uni-app 的条件编译（`// #ifdef H5` / `#ifndef`），
 *     在普通 Node 里两段都会生效 ⇒ 同一份 `export const API_BASE` 声明两次 ⇒ 语法错误；
 *   · 结果是「依赖 config 的模块无法在 Node 里直接 import」，纯函数也就没法单测。
 * 所以把纯计算摘出来、保持零依赖，就能被 `tests/guideQuery.test.mjs` 直接跑。
 *
 * ── 排序口径（与后端对齐）──────────────────────────────────────────
 * 后端 `PostServiceImpl`：
 *   latest  = 置顶优先 → created_at DESC → id DESC
 *   hot     = view_count + like_count*2 + reply_count*3 + 收藏数，再按时间兜底
 *   essence = 只取 is_essence=1，按时间倒序
 * ⚠️ 端内复算**不含收藏数** —— 列表接口不下发收藏数。差别如实记录，不假装一致。
 * ⚠️ 端内的「置顶优先」比后端多一个**作用域**限制，见 `makeCmpLatest` 的参数说明：
 *    官方帖的置顶只在**游戏详情页**内生效，聚合列表（攻略页/资讯页）不吃。
 * 取值字面量与 `api/config.js#SORT` 一致（那边是给请求用的，这边是给本地排序用的）。
 */

const S = { LATEST: 'latest', HOT: 'hot', ESSENCE: 'essence' }

/** 后端 `is_essence` / `is_top` 是 0/1，JSON 里可能是数字也可能是字符串 */
const isOn = (v) => Number(v) === 1

/**
 * 生成「最新」比较器：置顶优先 → 时间倒序 → id 倒序。
 *
 * @param {number} [scopedTopUid] 该账号的**置顶不参与排序**（传 0 = 所有置顶都生效）
 *
 * ── 为什么要这个参数（2026-09-21，用户要求「置顶改成只在游戏详情页内优先」）──
 * `post.is_top` 这一列装着**两种语义**：
 *   · 普通置顶（版主/管理员）：把某篇置顶在它所属的板块里 ⇒ 板块列表、聚合列表都该照办
 *     （实测线上「攻略心得」里就有这样一条真置顶，不能误伤）；
 *   · 官方帖置顶（`OFFICIAL_UID`）：官方公告是**在它所属的那款游戏里**置顶
 *     （用户原话「默认在每个游戏里置顶和加精」）。
 * 游戏详情页正是「一款游戏」的视图 ⇒ 官方帖该在最前。它走的是后端
 * `/games/{id}/posts`（`ORDER BY is_top`），**根本不经过这个文件**，所以天然保留。
 * 但攻略页/资讯页是**跨游戏的全景聚合**：20 条官方帖若在这里也按 is_top 打头，
 * 资讯页首屏 12 张会被官方公告整屏占满、玩家投稿全被压到下面（用户实报的现象）。
 * ⇒ 聚合列表传 `scopedTopUid = OFFICIAL_UID`，把官方帖的置顶**限定在游戏详情页内**。
 *
 * ⚠️ 用 `Number(...)` 比较：索引经 localStorage 往返后 userId 可能是字符串，
 *   直接全等会**静默失效**（官方帖照旧被顶到最前，而排序看起来"正常"）。
 */
export function makeCmpLatest(scopedTopUid = 0) {
  const scoped = Number(scopedTopUid) || 0
  /** 置顶权重：官方帖在被限定作用域时按 0 计（= 不置顶） */
  const rank = (it) => (isOn(it.isTop) && !(scoped && Number(it.userId) === scoped) ? 1 : 0)
  return (a, b) => {
    const ta = rank(a)
    const tb = rank(b)
    if (ta !== tb) return tb - ta
    const da = String(a.createdAt || '')
    const db = String(b.createdAt || '')
    if (da !== db) return da < db ? 1 : -1
    return Number(b.id) - Number(a.id)
  }
}

/**
 * 通用「最新」比较器 —— 所有置顶都生效。
 * 保留两参签名：`relatedOf`（相关推荐）与 `tests/guideQuery.test.mjs` 都在用。
 */
export const cmpLatest = makeCmpLatest(0)

/** 热门权重 —— 浏览 + 点赞×2 + 回复×3（与后端一致，差一个「收藏数」） */
export function hotScore(it) {
  return (Number(it.viewCount) || 0) + (Number(it.likeCount) || 0) * 2 + (Number(it.replyCount) || 0) * 3
}

/**
 * 在索引上做筛选 + 排序。
 * @param {Array}  items 索引记录
 * @param {{platform?:string, sort?:string, keyword?:string, scopedTopUid?:number}} [opt]
 *   `scopedTopUid`：该账号的置顶不计入排序（聚合列表传 `OFFICIAL_UID`，见 `makeCmpLatest`）
 * @returns {Array} 新数组（**不改动入参**）
 */
export function queryIndex(items, { platform = '', sort = S.LATEST, keyword = '', scopedTopUid = 0 } = {}) {
  let out = Array.isArray(items) ? items.slice() : []
  if (platform) out = out.filter((it) => it.platform === platform)

  const kw = String(keyword || '').trim().toLowerCase()
  if (kw) {
    out = out.filter((it) =>
      `${it.title || ''} ${it.summary || ''} ${it.gameName || ''}`.toLowerCase().includes(kw)
    )
  }

  // 🚨 三条口径共用同一个比较器（含最热/精华的**兜底排序**也是时间倒序）。
  //    只改「最新」是不够的：「最热」在权重相同时会回落到 cmpLatest，
  //    官方帖照样被顶上去 ⇒ 用户切一下排序就看到两套顺序，像 bug。
  const cmp = makeCmpLatest(scopedTopUid)

  if (sort === S.ESSENCE) return out.filter((it) => isOn(it.isEssence)).sort(cmp)
  if (sort === S.HOT) return out.sort((a, b) => hotScore(b) - hotScore(a) || cmp(a, b))
  return out.sort(cmp)
}

/**
 * 每个平台各有几篇（含「全部」= `''` 键）。
 * ⚠️ 数量必须来自**同一个数据源**（索引），否则按钮上的数字会与筛出来的条数对不上。
 * @returns {Record<string, number>}
 */
export function countByPlatform(items) {
  const list = Array.isArray(items) ? items : []
  const out = { '': list.length }
  list.forEach((it) => {
    const k = it.platform || ''
    if (k) out[k] = (out[k] || 0) + 1
  })
  return out
}

/**
 * 每款游戏各有几篇（键 = `gameId`）。
 *
 * ── 为什么需要它（2026-09-26，用户实报）────────────────────────────
 * 游戏库卡片右下角那个「N 帖」原来直接用了游戏接口的 `postCount`，
 * 而它是**主站口径**：`game.post_count` 数的是该游戏在**全部 6 个板块**的可见帖
 * （`016-v12-content-reset.sql` 里那条 `UPDATE game g SET post_count = (...)` 没带 board 条件）。
 * 本端只聚合 **攻略心得(board 1) + 资讯速递(board 4)** ⇒ 数字必然虚高。
 * 用户实报的「白夜极光」最典型：卡片写 1 帖，点进去两个 Tab 全空 ——
 * 那唯一 1 帖发在 board 2「游戏吐槽」。线上 81 款里 **63 款**对不上，**全部虚高**。
 *
 * 这里改成在**端内索引**上累计 —— 索引的内容池就是 `GUIDE_BOARDS`(board 1 + 4)，
 * 于是「卡片上写几」与「点进去能看几」在**构造上**是同一个集合，
 * 口径的**唯一真源**变成 `api/config.js#GUIDE_BOARDS`：将来增减板块，两边一起变，不会再漂移。
 *
 * ⚠️ 没有 `gameId` 的帖子（未关联游戏的杂谈）不计数 —— 它们在游戏详情页里本来也不出现。
 *
 * @param {Array} items 索引记录
 * @returns {Record<string, number>} `{ [gameId]: 篇数 }`
 */
export function countByGame(items) {
  const list = Array.isArray(items) ? items : []
  const out = {}
  list.forEach((it) => {
    const gid = Number(it.gameId)
    if (!gid) return
    out[gid] = (out[gid] || 0) + 1
  })
  return out
}

/** 索引概览（首页统计条用）：总篇数 / 覆盖游戏数 / 有内容的平台数 */
export function indexStats(items) {
  const list = Array.isArray(items) ? items : []
  const games = new Set()
  const platforms = new Set()
  list.forEach((it) => {
    if (it.gameName) games.add(it.gameName)
    if (it.platform) platforms.add(it.platform)
  })
  return { total: list.length, games: games.size, platforms: platforms.size }
}

/**
 * 相关推荐 —— 详情页读完之后的「下一条」。
 * 优先级：同游戏 → 同平台 →（都不够时）同板块；永远排除自己。
 *
 * @param {Array}  items 索引记录
 * @param {object} post  当前帖
 * @param {number} [limit]
 */
export function relatedOf(items, post, limit = 6) {
  const list = Array.isArray(items) ? items : []
  if (!post || post.id == null) return []
  const rest = list.filter((it) => it.id !== post.id)
  const sameGame = rest.filter((it) => post.gameName && it.gameName === post.gameName)
  const plat = post.platform || (list.find((it) => it.id === post.id) || {}).platform || ''
  const samePlat = rest.filter((it) => plat && it.platform === plat && it.gameName !== post.gameName)
  const sameBoard = rest.filter((it) => it.boardId === post.boardId)

  const out = []
  const seen = new Set()
  const pushAll = (arr) => {
    arr.forEach((it) => {
      if (out.length >= limit || seen.has(it.id)) return
      seen.add(it.id)
      out.push(it)
    })
  }
  pushAll(sameGame.sort(cmpLatest))
  pushAll(samePlat.sort((a, b) => hotScore(b) - hotScore(a) || cmpLatest(a, b)))
  pushAll(sameBoard.sort((a, b) => hotScore(b) - hotScore(a) || cmpLatest(a, b)))
  return out
}

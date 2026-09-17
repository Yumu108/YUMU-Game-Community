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
 * 取值字面量与 `api/config.js#SORT` 一致（那边是给请求用的，这边是给本地排序用的）。
 */

const S = { LATEST: 'latest', HOT: 'hot', ESSENCE: 'essence' }

/** 后端 `is_essence` / `is_top` 是 0/1，JSON 里可能是数字也可能是字符串 */
const isOn = (v) => Number(v) === 1

/** 最新：置顶优先 → 时间倒序 → id 倒序 */
export function cmpLatest(a, b) {
  const ta = isOn(a.isTop) ? 1 : 0
  const tb = isOn(b.isTop) ? 1 : 0
  if (ta !== tb) return tb - ta
  const da = String(a.createdAt || '')
  const db = String(b.createdAt || '')
  if (da !== db) return da < db ? 1 : -1
  return Number(b.id) - Number(a.id)
}

/** 热门权重 —— 浏览 + 点赞×2 + 回复×3（与后端一致，差一个「收藏数」） */
export function hotScore(it) {
  return (Number(it.viewCount) || 0) + (Number(it.likeCount) || 0) * 2 + (Number(it.replyCount) || 0) * 3
}

/**
 * 在索引上做筛选 + 排序。
 * @param {Array}  items 索引记录
 * @param {{platform?:string, sort?:string, keyword?:string}} [opt]
 * @returns {Array} 新数组（**不改动入参**）
 */
export function queryIndex(items, { platform = '', sort = S.LATEST, keyword = '' } = {}) {
  let out = Array.isArray(items) ? items.slice() : []
  if (platform) out = out.filter((it) => it.platform === platform)

  const kw = String(keyword || '').trim().toLowerCase()
  if (kw) {
    out = out.filter((it) =>
      `${it.title || ''} ${it.summary || ''} ${it.gameName || ''}`.toLowerCase().includes(kw)
    )
  }

  if (sort === S.ESSENCE) return out.filter((it) => isOn(it.isEssence)).sort(cmpLatest)
  if (sort === S.HOT) return out.sort((a, b) => hotScore(b) - hotScore(a) || cmpLatest(a, b))
  return out.sort(cmpLatest)
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

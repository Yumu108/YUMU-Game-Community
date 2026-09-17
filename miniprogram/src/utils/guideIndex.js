/**
 * 端内聚合索引 —— 「多平台游戏知识的聚合与分类展示」的数据底座。
 *
 * ── 为什么需要这一层 ──────────────────────────────────────────────
 * 小程序定位是**纯干货攻略的聚合与分类展示端**，核心交互是
 * 「点平台标签 → 只看该平台的文章」。
 *
 * 但后端 `/posts` 只支持 `boardId / gameId / sort / current / size`，
 * **没有 platform 参数**，`post` 表也没有 platform 列 —— platform 只存在于 `game` 表。
 * 所以「按平台筛文章」只能在**端内**完成：把帖子与它所属游戏的平台关联起来。
 *
 * ── 做法（一次同步 + 本地缓存）────────────────────────────────────
 *   1. 拉内容池全量（`GUIDE_BOARDS` = 攻略心得 + 资讯速递；线上 155+99 = 254 帖，约 3 个请求）；
 *   2. 拉全部游戏（80 款 / 1 个请求）建立 `gameId → platform` 映射；
 *   3. 裁剪字段后写入本地存储（实测约 130KB），TTL 内直接命中缓存；
 *   4. 之后所有平台筛选 / 排序 / 分页都在本地完成 —— 切标签**零请求**，
 *      并且能在按钮上显示**精确数量**（这是服务端排序接口给不了的）。
 *
 * ── 代价（如实记录，别装作没有）──────────────────────────────────
 *   · 首次同步要走一次全量（254 帖 ≈ 100KB，已开 gzip）；之后命中缓存为 0 请求；
 *   · 新帖要等下一次同步（TTL 10 分钟过期 / 下拉刷新强刷）才会出现；
 *   · 内容池涨到几千帖时应改成后端加 platform 查询参数（join game 表即可，无需改表结构）。
 *
 * ── 与后端排序的口径一致性 ───────────────────────────────────────
 *   `hot` 权重照抄后端 `PostServiceImpl`：浏览 + 点赞×2 + 回复×3（**不含收藏数** ——
 *   列表接口不下发收藏数，端内无法复算；这一条差异在文档里注明，不假装完全一致）。
 *   `essence` 与后端一致：只保留精华帖，按时间倒序。
 */
import { fetchPosts, fetchGames } from '../api/community'
import { GUIDE_BOARDS, STORAGE_KEYS, SORT } from '../api/config'

/** 索引缓存有效期：10 分钟 */
const INDEX_TTL = 10 * 60 * 1000
/** 游戏平台映射变化极慢，单独缓存 24 小时 */
const PLATFORM_TTL = 24 * 60 * 60 * 1000
/** 单页拉取条数（后端接受 size=100；传更大也只回 100） */
const PAGE = 100
/** 安全上限：最多翻 6 页（600 条），防止接口异常导致无限翻页 */
const MAX_PAGES = 6

/**
 * 索引里保留的字段 —— 够 PostCard 渲染 + 平台归类 + 相关推荐即可。
 * 全字段约 1.2KB/条，裁剪后约 0.5KB/条（254 条 ≈ 130KB）。
 * ⚠️ `gameId` 必须留着：相关推荐要按「同一款游戏」聚合。
 */
const KEEP = [
  'id',
  'title',
  'cover',
  'gameCover',
  'gameName',
  'gameId',
  'boardId',
  'boardName',
  'createdAt',
  'likeCount',
  'replyCount',
  'viewCount',
  'isEssence',
  'isTop',
  'authorName'
]

function readCache(key) {
  try {
    const v = uni.getStorageSync(key)
    return v && typeof v === 'object' ? v : null
  } catch (e) {
    return null
  }
}

function writeCache(key, value) {
  try {
    uni.setStorageSync(key, value)
  } catch (e) {
    /* 存储写满/被禁用不阻断主流程：拿不到缓存时下次会重新同步 */
  }
}

/**
 * 逐页拉某个板块的全部帖子。
 * 🚨 分页参数是 `current` 不是 `page` —— 传错会被后端**静默忽略、恒返回第 1 页**。
 */
async function fetchBoardAll(boardId) {
  const out = []
  for (let p = 1; p <= MAX_PAGES; p++) {
    const res = await fetchPosts({ boardId, sort: SORT.LATEST, current: p, size: PAGE })
    const recs = (res && res.records) || []
    out.push(...recs)
    const total = (res && res.total) || 0
    if (!recs.length || out.length >= total) break
  }
  return out
}

/**
 * 全部游戏的元数据：`gameId → platform` 映射 + 类型清单（按收录量倒序）。
 *
 * 为什么要一次拿全：平台筛选只能靠这条映射把帖子归到平台；
 * 而「类型」在游戏库里要做筛选按钮，接口没有 distinct 端点，
 * 只能把 80 款游戏整体拉下来自己统计。两者共用同一份缓存（24h）。
 */
export async function ensureGameMeta() {
  const cached = readCache(STORAGE_KEYS.GAME_PLATFORM)
  if (cached && cached.map && Date.now() - (cached.at || 0) < PLATFORM_TTL) {
    return { map: cached.map, genres: cached.genres || [], platforms: cached.platforms || {} }
  }

  const map = {}
  const genreCount = {}
  const platCount = {}
  let got = 0
  for (let p = 1; p <= MAX_PAGES; p++) {
    const res = await fetchGames({ current: p, size: PAGE })
    const recs = (res && res.records) || []
    recs.forEach((g) => {
      if (!g || g.id == null) return
      map[g.id] = g.platform || ''
      if (g.platform) platCount[g.platform] = (platCount[g.platform] || 0) + 1
      const ge = (g.genre || '').trim()
      if (ge) genreCount[ge] = (genreCount[ge] || 0) + 1
    })
    got += recs.length
    const total = (res && res.total) || 0
    if (!recs.length || got >= total) break
  }
  const genres = Object.keys(genreCount)
    .map((name) => ({ name, count: genreCount[name] }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1))
  platCount[''] = got // 「全部」= 收录总数
  writeCache(STORAGE_KEYS.GAME_PLATFORM, { at: Date.now(), map, genres, platforms: platCount })
  return { map, genres, platforms: platCount }
}

/** 兼容旧调用：只要映射 */
async function fetchGamePlatforms() {
  const { map } = await ensureGameMeta()
  return map
}

/** 单条帖子 → 索引记录（补 `platform`、补 `summary`，丢掉 renderer 用不到的大字段） */
function toIndexItem(p, platformMap) {
  const o = { platform: platformMap[p.gameId] || '' }
  KEEP.forEach((k) => {
    o[k] = p[k]
  })
  // 列表接口的 `summary` 偶尔为空；正文在索引里不保留，所以这里补一次截断
  o.summary = p.summary || (p.content ? String(p.content).replace(/<[^>]+>/g, '').slice(0, 80) : '')
  return o
}

/** 读缓存（不管是否过期），供「同步失败时回退到上一次内容」 */
export function readCachedIndex() {
  const c = readCache(STORAGE_KEYS.GUIDE_INDEX)
  return c && Array.isArray(c.items) && c.items.length ? c : null
}

/** 并发去重：首页多个模块同时要索引时，只发一轮请求 */
let pending = null

/**
 * 取得内容池索引。
 *
 * @param {{force?: boolean}} [opt] force=true 跳过缓存（下拉刷新用）
 * @returns {Promise<{items: Array, at: number, fromCache: boolean, stale: boolean}>}
 *   stale=true 表示本次同步失败、返回的是上一次的内容（调用方应给用户一条提示）
 * @throws 无缓存可用且同步失败时抛出（调用方渲染 ErrorState + 重试）
 */
export async function ensureIndex({ force = false } = {}) {
  if (!force) {
    const c = readCache(STORAGE_KEYS.GUIDE_INDEX)
    if (c && Array.isArray(c.items) && Date.now() - (c.at || 0) < INDEX_TTL) {
      return { items: c.items, at: c.at, fromCache: true, stale: false }
    }
  }
  if (pending) return pending

  pending = (async () => {
    try {
      const [platformMap, ...boardLists] = await Promise.all([
        fetchGamePlatforms(),
        ...GUIDE_BOARDS.map((b) => fetchBoardAll(b))
      ])
      const seen = new Set()
      const items = []
      boardLists.forEach((rows) => {
        (rows || []).forEach((p) => {
          if (!p || p.id == null || seen.has(p.id)) return
          seen.add(p.id)
          items.push(toIndexItem(p, platformMap))
        })
      })
      if (!items.length) throw new Error('内容池为空')
      const at = Date.now()
      writeCache(STORAGE_KEYS.GUIDE_INDEX, { at, items })
      return { items, at, fromCache: false, stale: false }
    } catch (e) {
      // 同步失败：有旧内容就先给旧的（并标记 stale 让页面明说），否则交给页面渲染失败态
      const cached = readCachedIndex()
      if (cached) return { items: cached.items, at: cached.at, fromCache: true, stale: true }
      throw e
    } finally {
      pending = null
    }
  })()

  return pending
}

/* ==================== 筛选 / 排序 ==================== */
/**
 * 纯计算部分（筛选 / 排序 / 计数 / 相关推荐）全部落在 `guideQuery.js` ——
 * 那个文件**零 import**，因此可以在 Node 里直接跑单测（tests/guideQuery.test.mjs）；
 * 这里统一转出，让页面只认 `utils/guideIndex` 一个入口。
 */
export { queryIndex, countByPlatform, indexStats, relatedOf, hotScore, cmpLatest } from './guideQuery'

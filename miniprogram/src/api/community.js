/**
 * 接口封装 —— 全部为**现有公开接口**（后端零改动）。
 *
 * 🚨 两条硬约束（踩过坑）：
 *  1. **分页参数是 `current` 和 `size`，不是 `page`。**
 *     实测传 `page=2` 会被**静默忽略、恒返回第 1 页**，不报错 ——
 *     上拉加载写错会无限重复同一页。所以这里统一把分页收敛成 `current`。
 *  2. 响应统一 `Result{code,message,data}`，HTTP 恒 200；分页体为
 *     `PageResult{total,pages,current,size,records}`。
 */
import { get, post } from './request'
import { BOARD, SORT } from './config'

/* ==================== 游戏 ==================== */

/** 热门游戏（`data` 是**纯数组**，不是分页体） */
export const fetchHotGames = (limit = 8) => get('/games/hot', { limit })

/** 游戏列表（分页体） */
export const fetchGames = ({ current = 1, size = 12, keyword, platform, genre } = {}) =>
  get('/games', { current, size, keyword, platform, genre })

/** 游戏详情 */
export const fetchGameDetail = (id) => get(`/games/${id}`)

/** 某游戏下的帖子（攻略用 boardId=1，资讯用 boardId=4） */
export const fetchGamePosts = (gameId, { boardId, sort = SORT.LATEST, current = 1, size = 10 } = {}) =>
  get(`/games/${gameId}/posts`, { boardId, sort, current, size })

/** 某游戏的活跃玩家 */
export const fetchGameActiveUsers = (gameId, limit = 6) => get(`/games/${gameId}/active-users`, { limit })

/* ==================== 帖子 ==================== */

/** 帖子列表 */
export const fetchPosts = ({ boardId, gameId, sort = SORT.LATEST, current = 1, size = 10 } = {}) =>
  get('/posts', { boardId, gameId, sort, current, size })

/** 帖子详情（`view` 传 true 时后端会自增浏览数） */
export const fetchPostDetail = (id) => get(`/posts/${id}`)

/**
 * 回帖列表 —— **返回已归一化的 `{ records, total }`**。
 *
 * 🚨 2026-09-17 实测（P0）：`GET /posts/{id}/replies` 的 `Result.data` 是**裸数组**，
 *   不是分页体（且 `current` / `size` 会被服务端忽略，一次给全部 27 条）。
 *   详情页原来按分页体读 `r.records` / `r.total` ⇒ 两个字段恒为 `undefined`
 *   ⇒ 回复区永远渲染「还没有回复」、标题永远「回复 0」，
 *   27 条回复的讨论串**一条都看不到**，而且它伪装成正常的空态，线上挂了很久没人发现。
 *
 * 处理方式：在**这一层**归一化，调用方拿到的形状永远一致；
 *   同时保留对分页体的兼容 —— 后端将来真改成 PageResult 也不会再让页面空掉。
 */
export const fetchReplies = async (postId, { current = 1, size = 100 } = {}) => {
  const raw = await get(`/posts/${postId}/replies`, { current, size })
  const records = Array.isArray(raw) ? raw : (raw && raw.records) || []
  const total = !Array.isArray(raw) && raw && raw.total ? raw.total : records.length
  return { records, total }
}

/** 帖子标签 */
export const fetchPostTags = (postId) => get(`/posts/${postId}/tags`)

/* ==================== 板块 / 标签 ==================== */

/** 板块列表（固定六分类，带 postCount） */
export const fetchBoards = () => get('/boards')

/** 热门标签 */
export const fetchHotTags = (limit = 12) => get('/tags/hot', { limit })

/** 标签下帖子 */
export const fetchTagPosts = (tagId, { current = 1, size = 10 } = {}) =>
  get(`/tags/${tagId}/posts`, { current, size })

/* ==================== 搜索 / 资讯 ==================== */

/**
 * 综合搜索
 * @param {string} keyword 关键词
 * @param {'all'|'post'|'board'|'user'|'game'} type 搜索类型，默认 all
 * @returns type=all 时返回 `{posts: PageResult, boards: [], users: [], games: []}`
 */
export const searchAll = (keyword, type = 'all', { current = 1, size = 10 } = {}) =>
  get('/search', { keyword, type, current, size })

/** 公告列表（⚠️ 线上当前可能为空数组，空时前端自动隐藏该模块） */
export const fetchAnnouncements = () => get('/announcements')

/** 每日精选（⚠️ 同上，可能为空） */
export const fetchDailyPicks = () => get('/picks/daily')

/** 首页/资讯页的三个快捷组合 —— 集中在此，避免各页面重复拼参数 */
export const homeSources = {
  /** 最新资讯（资讯速递板块） */
  news: (size = 5) => fetchPosts({ boardId: BOARD.NEWS, sort: SORT.LATEST, current: 1, size }),
  /** 推荐攻略（攻略心得板块 · 按热门加权） */
  guides: (size = 5) => fetchPosts({ boardId: BOARD.GUIDE, sort: SORT.HOT, current: 1, size })
}

export { BOARD, SORT, post }

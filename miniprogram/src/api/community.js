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

/* ---------- 点赞 / 收藏（2026-09-21 起改为**服务端真实**接口） ----------
 *
 * 🚨 口径变更：这两件事**必须先登录**（后端 `SecurityConfig` 里是 `authenticated()`，
 *   未带 token 直接 401）。原先小程序端用「本机记录」绕开了这个限制 ——
 *   结果是既不改服务端数据（`likeCount` 不动）、换个设备又全丢。
 *   现在统一走真接口，判定交给 `utils/authGate.js#requireLogin`。
 *
 * ⚠️ 开关式（toggle）而非「点赞 / 取消赞」两个端点：同一接口按当前状态取反，
 *   所以**不要**在本地自己推演状态，一律以返回值为准（并发/重复点击下本地推演会漂）。
 */

/** 点赞 / 取消点赞 → `{liked, likeCount}`（`likeCount` 是服务端真值，直接用） */
export const togglePostLike = (id) => post(`/posts/${id}/like`)

/** 收藏 / 取消收藏 → `{favorited}` */
export const togglePostFavorite = (id) => post(`/posts/${id}/favorite`)

/**
 * 回帖列表 —— **返回已归一化的 `{ records, total }`**。
 *
 * 🚨 保留原因（**当前详情页已不再展示回复**）：这里的归一化是为了记录一个真实的接口陷阱 ——
 *   `GET /posts/{id}/replies` 的 `Result.data` 是**裸数组**，不是分页体
 *   （且 `current` / `size` 会被服务端忽略，一次给全部 27 条）。
 *   详情页原来按分页体读 `r.records` / `r.total` ⇒ 两个字段恒为 undefined
 *   ⇒ 回复区永远渲染「还没有回复」，27 条的讨论串**一条都看不到**，
 *   而且它伪装成正常的空态，线上挂了很久没人发现。
 *
 * 2026-09-17 定位调整：小程序改为「多平台攻略聚合的展示端」，**弱化互动**，
 *   详情页的回复区已替换为「相关攻略」。本封装保留给将来可能的只读讨论视图 ——
 *   真要用时**必须走这里**，不要在页面里直接读 `.records`（那正是当初的 bug）。
 */
export const fetchReplies = async (postId, { current = 1, size = 100 } = {}) => {
  const raw = await get(`/posts/${postId}/replies`, { current, size })
  const records = Array.isArray(raw) ? raw : (raw && raw.records) || []
  const total = !Array.isArray(raw) && raw && raw.total ? raw.total : records.length
  return { records, total }
}

/**
 * 帖子标签 —— ⚠️ **陷阱：当前无页面使用，真要用也别调它**。
 *
 * 🚨 `GET /posts/{id}/tags` 后端**只注册了 PUT**（发帖人改标签），没有 GET
 *   ⇒ 调用必报 405「请求方法不支持：GET」（2026-09-17 实测，详情页曾因此每次进帖都弹此提示）。
 *   帖子标签的正确来源：**详情接口 `GET /posts/{id}` 的返回自带 `tags`**（PostVO#tags）。
 *   本封装保留仅作接口事实记录；若后端将来补了 GET，这里才可启用。
 */
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

/** 每日精选（编辑按日挑出的几条；⚠️ 按日期出题，拿不到就是空数组，页面自动隐藏该模块） */
export const fetchDailyPicks = () => get('/picks/daily')

/**
 * ⚠️ 保留但**当前未被页面使用**的封装：
 *   `fetchHotGames` / `fetchBoards` / `fetchTagPosts` / `fetchGameActiveUsers` / `fetchReplies`
 *
 * 为什么留着而不是删掉：这一层是后端公开接口的**客户端全貌**，每条都带着踩过的坑
 *   （比如 fetchReplies 的「裸数组」陷阱），删掉就等于把接口事实一起删了。
 * 什么时候真正用得上：首页改版若要加「热门游戏」横滑（fetchHotGames）、
 *   分类页若要按板块/标签视角展开（fetchBoards / fetchTagPosts）。
 *
 * 2026-09-17 定位调整后**已删除** `homeSources`（首页三个快捷组合）——
 *   它是页面专用拼装，首页改成端内聚合后不再有调用方，留着才是真死代码。
 */
export { BOARD, SORT, post }

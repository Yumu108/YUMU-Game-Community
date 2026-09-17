/**
 * 端点配置（**单一来源**）—— 两处地址差异只在条件编译块里体现，
 * 其它文件一律从这里 import，避免 H5 / 小程序两套地址散落各处。
 *
 * ┌ H5 ────────── 部署在 http://8.133.255.202/m/，与后端**同源** → 用相对路径 `/api`
 * │               开发期由 ../vite.config.js 的 /api 代理转发到线上后端（不触发跨域）
 * └ 小程序 ────── 无同源概念，必须绝对地址；开发期在开发者工具勾选「不校验合法域名」
 *
 * ⚠️ 后端 context-path 已是 `/api`，所以下面拼出来的完整地址是 `http://<host>/api/...`。
 */

// #ifdef H5
/** 请求前缀（用于 uni.request 的 url） */
export const API_BASE = '/api'
/** 静态资源（图片）前缀 —— 同源留空即可，`/api/files/x.png` 直接可用 */
export const ASSET_BASE = ''
// #endif

// #ifndef H5
/** 请求前缀（用于 uni.request 的 url） */
export const API_BASE = 'http://8.133.255.202/api'
/** 静态资源（图片）前缀 —— 小程序端必须补全主机名 */
export const ASSET_BASE = 'http://8.133.255.202'
// #endif

/** 本地存储键 */
export const STORAGE_KEYS = {
  TOKEN: 'yumu_token',
  HISTORY: 'yumu_history',
  FAVORITES: 'yumu_favorites'
}

/**
 * 板块固定 id（与后端 `board` 表一致）。
 * 小程序只用到「攻略心得」和「资讯速递」两块，其余留作扩展。
 */
export const BOARD = {
  GUIDE: 1, // 攻略心得
  CHAT: 2, // 游戏吐槽
  TEAM: 3, // 玩家天地（原「组队大厅」）
  NEWS: 4, // 资讯速递
  CREATION: 5, // 二次创作
  OTHER: 6 // 其他
}

/**
 * 帖子排序的合法取值（已核对后端 `PostServiceImpl` 分支）。
 * ⚠️ 传错值不会报错，会**静默回退**成默认排序。
 */
export const SORT = {
  LATEST: 'latest', // 最新（默认）
  HOT: 'hot', // 热门（加权）
  ESSENCE: 'essence', // 精华
  REPLY: 'reply', // 最多回复
  FAVORITE: 'favorite', // 最多收藏
  ALL: 'all'
}

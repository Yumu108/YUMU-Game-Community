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
/**
 * 静态资源（图片）前缀 —— H5 **必须给绝对地址**。
 *
 * 🚨 2026-09-17 实测（P0）：H5 里 uni-app 的 `<image>` 会按 `manifest.h5.router.base`
 *   （本项目是 `/m/`）解析**根相对路径**，于是 `/api/files/x.jpg` 被发成
 *   `/m/api/files/x.jpg` —— 本地 404、线上被 SPA 回退兜成 text/html ⇒ 全部图片解码失败。
 *   用 `location.origin` 拼成绝对地址（`http://host/api/files/x.jpg`）后不再受 base 影响。
 *
 * 对照证据：同页面普通 `<img src="/api/files/x.jpg">` 是正常的（不受 base 影响），
 *   只有 `<image>` 组件会加前缀 —— 所以问题出在这一层，与 nginx / 后端无关。
 */
export const ASSET_BASE = typeof location !== 'undefined' && location.origin ? location.origin : ''
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
  FAVORITES: 'yumu_favorites',
  LIKES: 'yumu_likes',
  /** 端内聚合索引（帖子池 + 平台归属），见 utils/guideIndex.js */
  GUIDE_INDEX: 'yumu_guide_index',
  /** 全部游戏的 `gameId → platform` 映射（变化很慢，单独长缓存） */
  GAME_PLATFORM: 'yumu_game_platform'
}

/**
 * 板块固定 id（与后端 `board` 表一致）。
 *
 * 🚨 2026-09-17 定位调整：小程序从「社区消费端」改为**纯干货攻略的聚合展示端**
 *   （弱化讨论互动），内容池只保留下面 `GUIDE_BOARDS` 两块。
 *   其余板块（吐槽 / 玩家天地 / 二次创作 / 其他）**不进小程序**，别再加回来 —— 
 *   这是产品口径，不是技术限制。
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
 * **干货内容池** —— 小程序端只聚合这两个板块的内容。
 * 线上实测：攻略心得 155 帖 + 资讯速递 99 帖 = 254 帖，全部带封面。
 */
export const GUIDE_BOARDS = [BOARD.GUIDE, BOARD.NEWS]

/**
 * 平台档位 —— value **必须与后端 `game.platform` 的字面量完全一致**，
 * 否则端内归类会全部落空（后端取值实测：多平台 / PC / 主机 / 手机）。
 *
 * ⚠️ 展示名与取值故意不同：库里存的是 `手机`，面向用户的叫法是 `手游`。
 *   改展示名只动 `PLATFORM_TABS` 的 label，**不要动 value**。
 */
export const PLATFORM = {
  MULTI: '多平台',
  PC: 'PC',
  CONSOLE: '主机',
  MOBILE: '手机'
}

/**
 * 平台筛选按钮（顺序即 UI 顺序）。`value: ''` 表示不过滤。
 * 数量在运行时由 `utils/guideIndex.js#countByPlatform` 填进去。
 */
export const PLATFORM_TABS = [
  { label: '全部', value: '' },
  { label: '多平台', value: PLATFORM.MULTI },
  { label: 'PC', value: PLATFORM.PC },
  { label: '主机', value: PLATFORM.CONSOLE },
  { label: '手游', value: PLATFORM.MOBILE }
]

/** 平台 → 展示色（PlatformFilter 用，取 App.vue 的主题令牌） */
export const PLATFORM_HINT = {
  [PLATFORM.PC]: 'PC / 单机大作',
  [PLATFORM.CONSOLE]: '主机独占 / 跨世代',
  [PLATFORM.MOBILE]: '手游 / 移动端',
  [PLATFORM.MULTI]: '全平台通吃'
}

/**
 * 帖子排序的合法取值（已核对后端 `PostServiceImpl` 分支）。
 * ⚠️ 传错值不会报错，会**静默回退**成默认排序。
 *
 * 🚨 端内索引排序（`utils/guideIndex.js`）只实现 latest / hot / essence 三种，
 *   权重与后端保持一致：hot = 浏览 + 点赞×2 + 回复×3（后端还含收藏数，
 *   但列表接口不下发收藏数，端内无法复算 —— 见该文件注释）。
 */
export const SORT = {
  LATEST: 'latest', // 最新（默认）
  HOT: 'hot', // 热门（加权）
  ESSENCE: 'essence', // 精华
  REPLY: 'reply', // 最多回复
  FAVORITE: 'favorite', // 最多收藏
  ALL: 'all'
}

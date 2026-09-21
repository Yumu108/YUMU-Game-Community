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
/**
 * 主站页面基址 —— H5 与后端/主站**同源**（nginx 把 `/` 给主站、`/m/` 给本端），
 * 协议页直接用 `location.origin`；本地 serve-h5 场景下打开的会是本地地址
 * （回归测试里 window.open 会被打桩，不影响断言）。
 */
export const SITE_BASE = typeof location !== 'undefined' && location.origin ? location.origin : ''
// #endif

// #ifndef H5
/** 请求前缀（用于 uni.request 的 url） */
export const API_BASE = 'http://8.133.255.202/api'
/** 静态资源（图片）前缀 —— 小程序端必须补全主机名 */
export const ASSET_BASE = 'http://8.133.255.202'
/** 主站页面基址 —— 小程序端无同源概念，直接写线上地址 */
export const SITE_BASE = 'http://8.133.255.202'
// #endif

/**
 * 主站协议页（history 路由，路径 `/agreement`、`/privacy`，见主站 router/index.js）。
 * 注册勾选行的两个链接从这里取 —— 别在页面里手写 URL。
 */
export const LEGAL_LINKS = {
  agreement: `${SITE_BASE}/agreement`,
  privacy: `${SITE_BASE}/privacy`
}

/** 本地存储键 */
export const STORAGE_KEYS = {
  TOKEN: 'yumu_token',
  /** 登录用户信息（与 token 同生命周期，见 utils/store.js 的 session 段） */
  USER: 'yumu_user',
  HISTORY: 'yumu_history',
  /**
   * 搜索历史（搜过的**关键词**字符串数组，见 utils/searchHistory.js）。
   *
   * ⚠️ 与上面的 `HISTORY` 是**两回事**，别复用同一个键：
   *   `HISTORY` = 浏览历史（看过的帖子，对象数组，见 utils/store.js）；
   *   `SEARCH_HISTORY` = 搜索历史（纯字符串数组）。
   *   结构不同，复用会互相覆盖。
   */
  SEARCH_HISTORY: 'yumu_search_history',
  /**
   * ⚠️ 已废弃（2026-09-21）：`yumu_favorites` / `yumu_likes` 两个键**不再读写**。
   *   点赞与收藏改为「登录后才能用 + 数据在服务端」，本机不再保存这两类记录。
   *   老设备里残留的旧数据无害（没人再读它），也不要写迁移逻辑 —— 那批数据
   *   本身就是「不真实的点赞」（没进服务端、没算进 likeCount）。
   */
  /** 本机已举报的帖子 id 列表（防重复举报入口，见 utils/store.js） */
  REPORTED: 'yumu_reported',
  /**
   * 端内聚合索引（帖子池 + 平台归属 + **当前用户的 liked/favorited**），见 utils/guideIndex.js。
   *
   * 🚨 键名带版本号是**故意的**，每次改缓存结构都要升。历史：
   *   v2 → v3（9-21）：记录新增 `userId`（端内识别官方帖）。不升版本的话，
   *     老设备那份没有 `userId` 的缓存会让官方角标全部落空 —— 属于「静默错」。
   *   v3 → v4（9-21，**本次**）：记录新增 `liked` / `favorited`（「我的」页的收藏/点赞列表
   *     由端内索引给出）。不升版本的话，老设备那份**没有这两个字段**的缓存会让
   *     收藏页、点赞页恒为空 —— 页面看起来就是「你还没收藏过」，而真相是缓存过期货。
   *   更早的 v1 曾把一份「游戏元数据为空」的坏缓存写进真机，导致平台分类整整坏一天、
   *   且**自愈不了**（详见 utils/apiGuard.js 头部复盘）。
   *   ⇒ 以后凡改动缓存的**语义或结构**，都照此升版本，别只改 TTL。
   *   （另有读时校验兜底：`utils/apiGuard.js#isUsableMeta` 会把空 map 判废。）
   *
   * ⚠️ 这份索引**带当前用户的点赞/收藏状态**（登录态下接口才下发），所以
   *   **登录 / 退出后必须清掉它重新同步**（`utils/guideIndex.js#clearIndexCache`，
   *   调用点在 pages/login 与 pages/my 的退出流程）—— 否则「我的」页那两份列表
   *   在 TTL（10 分钟）内会显示上一个身份的数据。
   */
  GUIDE_INDEX: 'yumu_guide_index_v4',
  /** 全部游戏的 `gameId → platform` 映射（变化很慢，单独长缓存；同样带 `_v2`，理由同上） */
  GAME_PLATFORM: 'yumu_game_platform_v2'
}

/**
 * 举报理由（预置单选）—— 2026-09-17 新增举报功能。
 * 提交到 `POST /reports`（targetType=1 帖子），主站「管理后台 → 举报处理」闭环。
 * reason 后端上限 200 字，预置理由直接拼进 reason 字段。
 */
export const REPORT_REASONS = [
  '违法违规内容',
  '垃圾广告 / 导流',
  '引战 / 辱骂攻击',
  '内容不实 / 误导',
  '侵权 / 冒用他人作品'
]

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
 * **干货内容池** —— 端内索引只拉这两个板块，别再加别的板块。
 *
 * 🚨 2026-09-21 口径变更（重要，别再按老理解读这里）：
 *   这块常量**不再表示「一个页面聚合两个板块」**，而是「索引需要覆盖的两个板块」，
 *   两个板块分别归两个页面：
 *     · `BOARD.GUIDE`（攻略心得）→ 首页「攻略」页（`pages/index`）
 *     · `BOARD.NEWS`（资讯速递）→ 底部「资讯」页（`pages/news`）
 *   两页**零重叠**。之前是首页聚合两块 + 资讯页取子集，用户反馈「重复、没用」。
 *   合并拉取仍划算：两页共用同一份索引 ⇒ 两页间切换**零请求**。
 *
 * 线上实测（9-21）：攻略心得 155 帖 + 资讯速递 119 帖（含 20 条官方帖）。
 */
export const GUIDE_BOARDS = [BOARD.GUIDE, BOARD.NEWS]

/**
 * 官方资讯账号的 user.id（2026-09-21 新增）。
 *
 * 定位：`YUMU官方资讯`（username `yumu_official`），由 `db-seed/fetch_official.py`
 * 从 Steam 官方公告抓取 + AI 改写成中文资讯帖后，以该账号名义发到 board 4。
 *
 * 2026-09-21 二次调整：官方帖**不再独占资讯页** —— 资讯页现在放「资讯速递」板块的**全部**帖
 * （官方公告 + 玩家投稿），官方帖靠三件事凸显：`is_top=1`（置顶）+ `is_essence=1`（精华）
 * + 前端按本 uid 渲染的「官方」角标。置顶/精华是**落库字段**，不在这里做判断。
 *
 * 为什么要用 uid 而不是昵称：昵称是**可改的展示字段**，一旦被改，
 * 端内「官方帖」的识别会静默失效（帖子照样在，只是标签没了）。
 * uid 不会变。改动账号时同步改这里，并重跑一遍 `tests/verify-miniprogram.cjs`。
 *
 * ⚠️ 角色是 USER 而非 ADMIN —— 它只需要「发帖」，不需要后台权限。
 *   脚本里存着它的凭据，给它 ADMIN 等于凭空多一个高权限入口。
 *   帖子直发靠灌库时写 `status=0`，与该账号的角色无关。
 */
export const OFFICIAL_UID = 20142

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

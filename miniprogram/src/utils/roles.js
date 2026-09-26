/**
 * 角色 / 权限 —— **零依赖纯函数**（同 aiProtocol.js / mdLite.js 的约定，可直接在 Node 下单测）。
 *
 * ======================== 这个文件解决什么问题 ========================
 * 作业要求 D 里的「权限方案」，在小程序端原本**一点都体现不出来**：
 * 后端有完整的 RBAC（`role` / `user_role` / `moderator_board` 三张表 +
 * `@PreAuthorize` + `canModeratePost`），但小程序端既不渲染角色、也不按角色做任何显隐。
 *
 * 排查后发现后端几乎不用改：`UserInfoVO`（登录响应 `data.user` 与 `GET /auth/me`）
 * 本来就带 `roles` / `badge` / `badgeColor` / `badgeText` / `moderatorBoardNames`，
 * 断点只在 `utils/store.js#setUser` 把角色字段丢掉了。
 * 2026-09-26 第二轮为了做**作用域判定**，后端补下了 `moderatorGameIds`（2 行，见 §作用域）。
 *
 * ⇒ 所以「体现权限方案」的工程量 = **把已有字段接出来 + 按角色决定显示什么**。
 *    本文件负责后半截（纯逻辑，可测），`api/admin.js` 负责接口，
 *    `pages/my/my.vue` 与 `pages/post/detail.vue` 负责渲染。
 *
 * ======================== 与后端权限的一一对应 ========================
 * 🚨 下面这张表是**后端 `AdminController` 的事实**，不是设计愿望。
 *    每次改文案 / 加能力，都要回后端核对注解，别凭印象写。
 *
 * | 能力                        | ADMIN | MODERATOR      | 后端守卫 |
 * |-----------------------------|-------|----------------|----------|
 * | 置顶 / 取消置顶              | ✅    | ❌             | 方法级 `@PreAuthorize("hasRole('ADMIN')")` |
 * | 帖子转回待审核               | ✅    | ❌             | 同上 |
 * | 审核通过 / 驳回              | ✅※   | ✅※            | `canReviewPost`（※自己不能审自己） |
 * | 加精 / 取消加精              | ✅    | ✅（限辖区）   | `assertCanModeratePost` |
 * | 隐藏 / 恢复帖子              | ✅    | ✅（限辖区）   | `assertCanModeratePost` |
 * | 隐藏 / 恢复回复              | ✅    | ✅（限辖区）   | 走板块归属判定 |
 * | 处理举报                     | ✅    | ✅（限辖区）   | `canModerateReportTarget` |
 * | 游戏库管理 / 用户与角色管理 / 审计日志 / 公告 | ✅ | ❌ | 各自 Controller 类级 ADMIN |
 *
 * ── 三个维度上 ADMIN 与 MODERATOR 的真实差异（不是只差一个置顶） ──
 *  ① **作用域**：ADMIN 全站；MODERATOR 只有 `MAX_GAMES_PER_MOD = 1` 个游戏。
 *  ② **能力**：见上表 —— ADMIN 另有置顶、转待审、后台四大块。
 *  ③ **数据量**：`GET /admin/posts` 里 ADMIN 传 `coverage=null`（全站），
 *     版主传自己的授权集合（只剩辖区）。
 *
 * 🚨 本文件的判断**只用于「体验层的显隐」**（该不该显示入口）。
 *    **真正的安全边界永远在后端**：改包 / 直连接口一样会被 `@PreAuthorize` 拦成 403。
 *    别在任何地方把这里的 false 当成防护 —— 那正是 OASys 项目 BUG-002
 *    「考勤微服务不校验 JWT 就放行」的反面教训。
 */

/** 角色 code（与后端 `role.code` 一致，大写） */
export const ROLE = {
  USER: 'USER',
  MODERATOR: 'MODERATOR',
  ADMIN: 'ADMIN'
}

/* 🎨 配色词表**沿用后端 `BadgeService` 的取值**（danger=管理员 / warning=版主），
 *   不在前端另发明一套。好处：后端改配色前端零改动，且两端日志/样式能对上号。
 *   `default` 是前端为「普通用户」补的，后端对普通用户不下发 badgeColor（恒 null）。 */
export const TONE = {
  ADMIN: 'danger',
  MODERATOR: 'warning',
  USER: 'default'
}

/**
 * 「管辖范围」判定结果 —— 决定管理入口显不显示、以及提示文案怎么说。
 *
 * `OUT` 与本文件其它结论不同：它是**确定的否定**（我确实不管这个游戏），
 * 所以可以直接把入口藏掉，连 can-review 都不用发。
 * `UNKNOWN` 才是「我不知道」⇒ 回退到后端探测。
 */
export const SCOPE = {
  /** 管理员：全站，处处可管 */
  ALL: 'all',
  /** 版主且该帖在负责的游戏内 */
  IN: 'in',
  /** 版主但该帖**不在**负责的游戏内 —— 越权方向，必须拦 */
  OUT: 'out',
  /** 角色信息不足（老接口没下发 gameIds、或帖子没带 gameId）⇒ 交给后端判 */
  UNKNOWN: 'unknown',
  /** 普通用户 / 游客：无任何后台权限 */
  NONE: 'none'
}

const arr = (v) => (Array.isArray(v) ? v : [])

/** 只保留合法的字符串角色 code（去重、去空） */
function normalizeRoles(v) {
  const out = []
  arr(v).forEach((r) => {
    if (typeof r === 'string' && r && !out.includes(r)) out.push(r)
  })
  return out
}

/** 只保留合法的字符串（去重、去空）—— 游戏名 / 板块名共用 */
function normalizeNames(v) {
  const out = []
  arr(v).forEach((n) => {
    if (typeof n === 'string' && n && !out.includes(n)) out.push(n)
  })
  return out
}

/** 归一化成正整数 id 数组（后端下发的可能是数字或数字字符串；剔除 null/NaN） */
function normalizeIds(v) {
  const out = []
  arr(v).forEach((n) => {
    if (n == null) return
    const num = Number(n)
    if (Number.isFinite(num) && num > 0 && !out.includes(num)) out.push(num)
  })
  return out
}

/**
 * 从后端用户对象里抽出「身份 / 权限」相关字段（**唯一出口**）。
 *
 * 缺失一律降级成 '' / []，**绝不写 undefined**：
 * 组件里 `v-if` 对 undefined 与 '' 行为一致，但对数组长度判断不一致，
 * 混用会造出「有的账号显示徽章、有的直接报错」这类极难定位的差异。
 *
 * @param {object} user 后端 `UserInfoVO`（登录响应的 `data.user` 或 `/auth/me`）
 */
export function identityOf(user = {}) {
  const u = user || {}
  return {
    roles: normalizeRoles(u.roles),
    badge: u.badge || '',
    badgeColor: u.badgeColor || '',
    badgeText: u.badgeText || '',
    moderatorBoardIds: arr(u.moderatorBoardIds),
    moderatorBoardNames: normalizeNames(u.moderatorBoardNames),
    /**
     * 🚨 现行授权是**游戏级**（`moderator_board.board_id` 统一为 NULL），
     * 所以 `moderatorBoardIds` 对现在的版主**恒为 [null]→[]**；
     * 判断管辖范围必须用下面这两个，不能用 boardIds（2026-09-26 修正）。
     */
    moderatorGameIds: normalizeIds(u.moderatorGameIds),
    moderatorGameNames: normalizeNames(u.moderatorGameNames)
  }
}

/** 是否拥有某角色 code */
export function hasRole(roles, code) {
  return normalizeRoles(roles).includes(code)
}

/**
 * 判断某篇帖子是否落在当前用户的**管辖范围**内。
 *
 * 对应后端 `ModeratorBoardService#covers(userId, gameId, boardId)`：
 *  ① ADMIN → 直接放行（与 `assertCanModeratePost` 里 `if (isAdmin) return;` 一致）
 *  ② MODERATOR → 看帖子的 `gameId` 是否在 `moderatorGameIds` 里
 *
 * 🚨 为什么不能只看 `moderatorBoardNames`（第一轮就是这么写的，错的）：
 *    授权模型已改成**游戏级**，`board_id` 恒为 NULL ⇒ `listBoardNamesByUserId`
 *    查出来的板块名列表是空的，版主会被误判成「暂未分配负责板块」。
 *
 * ⚠️ `UNKNOWN` 不是失败，是「信息不足」的正常情形（老 session 缓存、帖子缺 gameId）。
 *    调用方**不能**把 UNKNOWN 当 false 处理，否则管理员/老账号会莫名丢入口。
 *
 * @param {object} user 后端 `UserInfoVO`
 * @param {object} post 帖子的 `PostVO`（需要 `gameId`，可退化用 `gameName`）
 * @returns {'all'|'in'|'out'|'unknown'|'none'} 见 `SCOPE`
 */
export function scopeOf(user = {}, post = {}) {
  const id = identityOf(user)
  if (id.roles.includes(ROLE.ADMIN)) return SCOPE.ALL
  if (!id.roles.includes(ROLE.MODERATOR)) return SCOPE.NONE

  const p = post || {}
  const gid = p.gameId == null ? null : Number(p.gameId)
  const hasGid = gid != null && Number.isFinite(gid)

  // ① 首选：帖子 gameId × 我的 gameIds —— 唯一不受游戏改名影响的判据
  if (hasGid && id.moderatorGameIds.length) {
    return id.moderatorGameIds.includes(gid) ? SCOPE.IN : SCOPE.OUT
  }
  // ② 兜底：老接口只有游戏名（或帖子没带 gameId）时按名字匹配
  //    ⚠️ 注意这里**不能提前 return** —— 帖子缺 gameId 但有 gameName 时仍要走这一步，
  //       否则「按名字兜底」形同虚设（单测 H8/H9 就是钉这个的）。
  const gname = p.gameName
  if (gname && id.moderatorGameNames.length) {
    return id.moderatorGameNames.includes(gname) ? SCOPE.IN : SCOPE.OUT
  }
  return SCOPE.UNKNOWN
}

/**
 * 是否**有资格**看到管理入口（= 管理员或版主）。
 *
 * 🚨 这只是「第一道本地闸门」。为什么必须有它：
 *    `/admin/**` 在类上挂了 `@PreAuthorize("hasAnyRole('ADMIN','MODERATOR')")`
 *    ⇒ 普通登录用户调**任意**一个（包括 `can-review`）都会拿到 `code=403`
 *      「无权限（需要管理员角色）」，而不是温和的 false。
 *    所以必须先本地判角色，否则**每个普通用户进详情页都会白挨一次 403**。
 *
 * ⚠️ 注意反面：本地为 true **不代表**对这篇帖子有权限 ——
 *    版主可能不管这个游戏。那要用 `scopeOf` 或 `fetchCanReview` 再判一次。
 */
export function canSeeManageEntry(roles) {
  return hasRole(roles, ROLE.ADMIN) || hasRole(roles, ROLE.MODERATOR)
}

/**
 * 是否**显示**管理入口 —— 综合「本地角色」「本地作用域」「后端 can-review」三个输入。
 *
 * 判决顺序（越靠前越确定，能省一次网络请求）：
 *   ① ADMIN                → 显示（与 `assertCanModeratePost` 的 ADMIN 直通一致）
 *   ② 非 ADMIN/MODERATOR   → 隐藏
 *   ③ scope === OUT        → **隐藏**。这是第二轮新增的关键分支：版主打开
 *                            非所辖游戏的帖子时，不该看到任何管理痕迹。
 *   ④ scope === IN         → 显示（辖区内的帖子，`hide`/`essence` 必然允许）
 *   ⑤ 其余（UNKNOWN）      → 回退到后端 `can-review` 探测
 *
 * 🚨 为什么不能只拿 `can-review` 当闸门（这里有个真实的语义陷阱）：
 *    后端有两个长得像但**不一样**的判断 ——
 *      · `canReviewPost`（`can-review` 端点用的）：ADMIN 全权，但 **`自己不能审自己`**
 *        （`if (post.getUserId().equals(viewerId)) return false;`）；
 *      · `assertCanModeratePost`（`essence` / `hide` / `restore` 用的）：ADMIN **直接 return**，
 *        版主看 `moderatorBoardService.covers(...)` —— **没有「不能操作自己的帖子」这条**。
 *    ⇒ 管理员看**自己发的帖子**时，`can-review` 会返回 false，但那四个管理动作其实全都能做。
 *      若拿 canReview 当唯一闸门，就会出现「管理员在公告帖上反而没有管理入口」的怪现象。
 *
 * ⇒ 所以：ADMIN 直接可见；版主先用本地作用域判（能 0 请求拦掉越权），
 *    判不出来才用 `can-review` 兜底。
 *
 * @param {string[]} roles 本地角色（`utils/store.js#getRoles`）
 * @param {boolean} canReview 后端 `GET /admin/posts/{id}/can-review` 的结果
 * @param {'all'|'in'|'out'|'unknown'|'none'} [scope] `scopeOf()` 的结果；不传则跳过作用域判定
 */
export function shouldShowManageEntry(roles, canReview, scope) {
  if (hasRole(roles, ROLE.ADMIN)) return true
  if (!hasRole(roles, ROLE.MODERATOR)) return false
  if (scope === SCOPE.OUT) return false
  if (scope === SCOPE.IN) return true
  return canReview === true
}

/**
 * 管理动作清单 —— 角色过滤 + 帖子状态过滤。
 *
 * `pin` 仅 ADMIN（后端方法上另有 `@PreAuthorize("hasRole('ADMIN')")`）；
 * 其余走 `assertCanModeratePost`（ADMIN 全权 / MODERATOR 限负责游戏）；
 * `approve` / `reject` 走 `canReviewPost` —— **额外带「自己不能审自己」**，
 * 所以必须 `ctx.canReview === true` 才给（这是版主**唯一**会被自己身份挡住的动作）。
 *
 * 状态互斥（避免列出会互相打脸的组合）：
 *   · 待审帖（status=2）→ 审核通过 / 驳回；**不再列**「恢复」（语义重叠，容易误点）
 *   · 隐藏帖（status=1）→ 恢复公开
 *   · 公开帖（status=0）→ 隐藏
 *
 * @param {string[]} roles 角色 code 列表
 * @param {{nonPublic?:boolean, pending?:boolean, canReview?:boolean}} [ctx]
 *        帖子是否为非公开 / 是否为待审帖 / 后端是否允许我审核
 * @returns {Array<{key:string,label:string,short:string,tip:string,adminOnly?:boolean,needsReason?:boolean}>}
 */
export function actionsFor(roles, ctx = {}) {
  const r = normalizeRoles(roles)
  const admin = r.includes(ROLE.ADMIN)
  const mod = r.includes(ROLE.MODERATOR)
  if (!admin && !mod) return []
  const nonPublic = ctx.nonPublic === true
  const pending = ctx.pending === true
  const canReview = ctx.canReview === true

  // `label` 给弹层按钮用（含 toggle 的两个方向）；`short` 给「一句话概览」用（如「我的权限」卡）。
  const list = []

  // ① 置顶：**管理员专属**（后端方法级 @PreAuthorize("hasRole('ADMIN')")）
  if (admin) {
    list.push({
      key: 'pin',
      label: '置顶 / 取消置顶',
      short: '置顶',
      tip: '管理员专属 · 全站生效',
      adminOnly: true
    })
  }

  // ② 审核闭环：版主的**本职工作**。后端带「自己不能审自己」⇒ 依赖 canReview。
  if (pending && canReview) {
    list.push({
      key: 'approve',
      label: '审核通过',
      short: '通过',
      tip: '通过后立即对所有访客可见'
    })
    list.push({
      key: 'reject',
      label: '驳回（需填理由）',
      short: '驳回',
      tip: '驳回后通知作者，作者可修改后重新提交',
      needsReason: true
    })
  }

  // ③ 加精
  list.push({
    key: 'essence',
    label: '加精 / 取消加精',
    short: '加精',
    tip: admin ? '全站生效' : '仅限你负责的游戏'
  })

  // ④ 隐藏 / 恢复（待审帖跳过：批准本身就会让它公开，再给「恢复」只会让人点错）
  if (!pending) {
    if (nonPublic) {
      list.push({ key: 'restore', label: '恢复公开', short: '恢复', tip: '恢复后所有访客可见' })
    } else {
      list.push({ key: 'hide', label: '隐藏帖子', short: '隐藏', tip: '隐藏后仅作者与管理员可见' })
    }
  }

  return list
}

/**
 * 能力矩阵 —— 「权限方案」最标准的呈现方式：把后端每一项权力摊成表格，
 * 逐条标出**当前角色能不能用**。答辩时这张表就是「我做了什么权限设计」的答案。
 *
 * 🚨 每条的 `api` 都是后端真实存在的路径，`capabilityMatrix` 的单测会**读后端源码**
 *    核对（`tests/roles.test.mjs` F 组）—— 别在这里写不存在的接口。
 *
 * `mp` 字段说明这项能力**在小程序端是否也接了按钮**：
 *   · true  → 端内有入口（置顶 / 加精 / 隐藏 / 恢复 / 审核）
 *   · false → 只在主站管理后台提供（游戏库、用户角色、审计日志、公告、举报列表）
 *             端内不做的原因：这些是重后台操作，硬塞进手机端既难用也不划算。
 *   如实标注「主站」比假装都有更经得起追问。
 */
export const CAPABILITIES = [
  {
    key: 'review',
    name: '审核帖子（通过 / 驳回）',
    admin: true,
    mod: true,
    scoped: true,
    mp: true,
    api: 'POST /admin/posts/{id}/approve · /reject',
    note: '自己发的帖子不能审'
  },
  {
    key: 'essence',
    name: '加精 / 取消加精',
    admin: true,
    mod: true,
    scoped: true,
    mp: true,
    api: 'POST /admin/posts/{id}/essence',
    note: ''
  },
  {
    key: 'hide',
    name: '隐藏 / 恢复帖子',
    admin: true,
    mod: true,
    scoped: true,
    mp: true,
    api: 'POST /admin/posts/{id}/hide · /restore',
    note: ''
  },
  {
    key: 'reply',
    name: '隐藏 / 恢复回复',
    admin: true,
    mod: true,
    scoped: true,
    mp: false,
    api: 'POST /admin/replies/{id}/hide · /restore',
    note: '端内未接，主站操作'
  },
  {
    key: 'report',
    name: '处理举报',
    admin: true,
    mod: true,
    scoped: true,
    mp: false,
    api: 'POST /admin/reports/{id}/handle',
    note: '端内未接，主站操作'
  },
  {
    key: 'pin',
    name: '置顶 / 取消置顶',
    admin: true,
    mod: false,
    scoped: false,
    mp: true,
    api: 'POST /admin/posts/{id}/pin',
    note: ''
  },
  {
    key: 'pending',
    name: '帖子转回待审核',
    admin: true,
    mod: false,
    scoped: false,
    mp: false,
    api: 'POST /admin/posts/{id}/pending',
    note: '端内未接，主站操作'
  },
  {
    key: 'game',
    name: '游戏库管理',
    admin: true,
    mod: false,
    scoped: false,
    mp: false,
    api: '/admin/games',
    note: '主站管理后台'
  },
  {
    key: 'user',
    name: '用户与角色管理 / 分配版主',
    admin: true,
    mod: false,
    scoped: false,
    mp: false,
    api: '/admin/users',
    note: '主站管理后台'
  },
  {
    key: 'audit',
    name: '查看操作审计日志',
    admin: true,
    mod: false,
    scoped: false,
    mp: false,
    api: '/admin/audit-logs',
    note: '主站管理后台'
  },
  {
    key: 'notice',
    name: '公告管理',
    admin: true,
    mod: false,
    scoped: false,
    mp: false,
    api: '/admin/notices',
    note: '主站管理后台'
  }
]

/**
 * 生成当前角色的权限矩阵（供「我的」页渲染）。
 *
 * @param {string[]} roles 角色 code 列表
 * @returns {Array<{key:string,name:string,api:string,note:string,mp:boolean,scoped:boolean,adminOnly:boolean,allowed:boolean}>}
 */
export function capabilityMatrix(roles) {
  const r = normalizeRoles(roles)
  const admin = r.includes(ROLE.ADMIN)
  const mod = r.includes(ROLE.MODERATOR)
  return CAPABILITIES.map((c) => ({
    key: c.key,
    name: c.name,
    api: c.api,
    note: c.note,
    mp: c.mp,
    scoped: c.scoped,
    /** 只有管理员有、版主没有 ⇒ UI 上标成「仅管理员」 */
    adminOnly: c.admin === true && c.mod !== true,
    allowed: admin ? c.admin === true : mod ? c.mod === true : false
  }))
}

/**
 * 能力计数 —— 用来在矩阵标题上写「你的角色可执行 5 / 11 项」。
 * 这个数字本身就是 ADMIN 与 MODERATOR 差异最直观的表达（11 vs 5）。
 */
export function capabilityStats(roles) {
  const list = capabilityMatrix(roles)
  return { total: list.length, allowed: list.filter((c) => c.allowed).length }
}

/**
 * 汇总当前用户的权限画像 —— 供「我的权限」卡片渲染。
 *
 * 优先级取**最高的那一个角色**展示（ADMIN > MODERATOR > USER），
 * 因为 `BadgeService` 也是这个口径（含 ADMIN 时不再显示「版主」）。
 *
 * 🚨 第二轮修正：版主的 `scope` **必须用 `moderatorGameNames`**。
 *    原来写的是 `moderatorBoardNames`，但授权模型已是游戏级（`board_id` 恒 NULL）
 *    ⇒ `listBoardNamesByUserId` 返回空 ⇒ 版主被显示成「暂未分配负责板块」，
 *    即使他明明管着一个游戏。这是纯逻辑 bug，`tests/roles.test.mjs` C/D 组有断言。
 *
 * @param {object} user 后端 `UserInfoVO`
 * @returns {{code:string,label:string,color:string,scope:string,scopeShort:string,can:string[]}}
 */
export function permissionSummary(user = {}) {
  const u = user || {}
  const roles = normalizeRoles(u.roles)

  if (roles.includes(ROLE.ADMIN)) {
    return {
      code: ROLE.ADMIN,
      label: '管理员',
      color: TONE.ADMIN,
      scope: '全站范围 · 所有游戏与板块',
      scopeShort: '全站',
      can: [
        '管理全部游戏的帖子与回复（含置顶、转待审）',
        '审核（通过 / 驳回）、加精、隐藏 / 恢复',
        '处理全站举报，分配版主，管理用户与公告',
        '查看全站操作审计日志'
      ]
    }
  }

  if (roles.includes(ROLE.MODERATOR)) {
    const games = normalizeNames(u.moderatorGameNames)
    const boards = normalizeNames(u.moderatorBoardNames)
    const label = games.join('、') || boards.join('、')
    return {
      code: ROLE.MODERATOR,
      label: '版主',
      color: TONE.MODERATOR,
      scope: label ? `仅限《${label}》` : '暂未分配负责游戏',
      scopeShort: label || '未分配',
      can: [
        '审核（通过 / 驳回）负责游戏下的帖子',
        '加精 / 隐藏 / 恢复负责游戏下的帖子',
        '处理负责游戏下的举报',
        '（置顶与全站管理属管理员权限）'
      ]
    }
  }

  return {
    code: ROLE.USER,
    label: '普通用户',
    color: TONE.USER,
    scope: '仅本人内容',
    scopeShort: '仅本人',
    can: [
      '浏览攻略 / 资讯 / 游戏库',
      '点赞、收藏、举报，查看浏览历史',
      '（发帖与回帖在主站进行）'
    ]
  }
}

/**
 * 徽章展示元数据。
 *
 * **优先用后端下发的 `badgeText` / `badgeColor`**（后端是单一事实来源，
 * 见 `BadgeService#compute`：ADMIN→danger/管理员、MODERATOR→warning/版主）。
 * 只有字段缺失时才按 roles 兜底 —— 这样后端改文案（比如以后加「超级版主」）
 * 前端不用跟着改。
 *
 * @returns {{text:string,color:string}} 无身份时 text 为 ''（调用方据此不渲染）
 */
export function badgeMeta(user = {}) {
  const u = user || {}
  const roles = normalizeRoles(u.roles)
  const fallback = roles.includes(ROLE.ADMIN)
    ? { text: '管理员', color: TONE.ADMIN }
    : roles.includes(ROLE.MODERATOR)
      ? { text: '版主', color: TONE.MODERATOR }
      : { text: '', color: '' }
  return {
    text: u.badgeText || fallback.text,
    color: u.badgeColor || fallback.color
  }
}

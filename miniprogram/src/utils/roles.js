/**
 * 角色 / 权限 —— **零依赖纯函数**（同 aiProtocol.js / mdLite.js 的约定，可直接在 Node 下单测）。
 *
 * ======================== 这个文件解决什么问题 ========================
 * 作业要求 D 里的「权限方案」，在小程序端原本**一点都体现不出来**：
 * 后端有完整的 RBAC（`role` / `user_role` / `moderator_board` 三张表 +
 * `@PreAuthorize` + `canModeratePost`），但小程序端既不渲染角色、也不按角色做任何显隐。
 *
 * 排查后发现**后端一行都不用改**：`UserInfoVO`（登录响应 `data.user` 与 `GET /auth/me`）
 * 本来就带 `roles` / `badge` / `badgeColor` / `badgeText` / `moderatorBoardNames`。
 * 断点只在 `utils/store.js#setUser` 把角色字段丢掉了。
 *
 * ⇒ 所以「体现权限方案」的最小工程量 = **把已有字段接出来 + 按角色决定显示什么**。
 *    本文件负责后半截（纯逻辑，可测），`api/admin.js` 负责接口，
 *    `pages/my/my.vue` 与 `pages/post/detail.vue` 负责渲染。
 *
 * ======================== 与后端权限的一一对应 ========================
 * | 角色      | 后端实际权力（`AdminController`）                                   |
 * |-----------|---------------------------------------------------------------------|
 * | ADMIN     | 全站：置顶 / 加精 / 隐藏 / 恢复 / 审核通过 / 驳回 / 举报处理 / 用户与公告管理 |
 * | MODERATOR | **仅自己负责的 (游戏, 板块) 对**：加精 / 隐藏 / 恢复 / 审核 / 举报处理 |
 * | USER      | 无后台权力（主站可发帖回帖）；端内只有点赞 / 收藏 / 举报             |
 *
 * 🚨 上面这张表是**后端的事实**，不是我们的设计愿望 —— 每次改这里的 `can` 文案，
 *    都要回 `AdminController` 与 `ModeratorBoardService` 核对一遍，别凭印象写。
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

const arr = (v) => (Array.isArray(v) ? v : [])

/** 只保留合法的字符串角色 code（去重、去空） */
function normalizeRoles(v) {
  const out = []
  arr(v).forEach((r) => {
    if (typeof r === 'string' && r && !out.includes(r)) out.push(r)
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
    moderatorBoardNames: arr(u.moderatorBoardNames).filter((n) => typeof n === 'string' && n)
  }
}

/** 是否拥有某角色 code */
export function hasRole(roles, code) {
  return normalizeRoles(roles).includes(code)
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
 *    版主可能不管这个板块。那要用 `fetchCanReview` 再问一次后端（见 api/admin.js）。
 */
export function canSeeManageEntry(roles) {
  return hasRole(roles, ROLE.ADMIN) || hasRole(roles, ROLE.MODERATOR)
}

/**
 * 是否**显示**管理入口 —— 综合「本地角色」与「后端 can-review 探测」两个输入。
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
 * ⇒ 所以：ADMIN 直接可见（与 `assertCanModeratePost` 的 ADMIN 直通一致）；
 *    版主才用 `can-review` 当 `covers(...)` 的近似探针（版主的两个判断用的是同一个
 *    `covers()`，唯一差异仍是自己发的帖 —— 那种情况会**少显示**，是安全方向）。
 *
 * @param {string[]} roles 本地角色（`utils/store.js#getRoles`）
 * @param {boolean} canReview 后端 `GET /admin/posts/{id}/can-review` 的结果
 */
export function shouldShowManageEntry(roles, canReview) {
  if (hasRole(roles, ROLE.ADMIN)) return true
  if (!hasRole(roles, ROLE.MODERATOR)) return false
  return canReview === true
}

/**
 * 管理动作清单 —— 角色过滤 + 公开性过滤。
 *
 * `pin` 仅 ADMIN（后端方法上另有 `@PreAuthorize("hasRole('ADMIN')")`）；
 * 其余走 `assertCanModeratePost`（ADMIN 全权 / MODERATOR 限负责板块）。
 *
 * 「隐藏」与「恢复」互斥：公开帖给「隐藏」，非公开帖（status≠0）给「恢复」——
 * 同时列出两个只会让人点错。
 *
 * @param {string[]} roles 角色 code 列表
 * @param {{nonPublic?: boolean}} [ctx] 当前帖是否为非公开（隐藏 / 待审）
 * @returns {Array<{key:string,label:string,short:string,tip:string}>} 供 UI 直接渲染
 */
export function actionsFor(roles, ctx = {}) {
  const r = normalizeRoles(roles)
  const admin = r.includes(ROLE.ADMIN)
  const mod = r.includes(ROLE.MODERATOR)
  if (!admin && !mod) return []
  const nonPublic = ctx.nonPublic === true

  // `label` 给弹层按钮用（含 toggle 的两个方向）；`short` 给「一句话概览」用（如「我的权限」卡）。
  const list = []
  if (admin) {
    list.push({ key: 'pin', label: '置顶 / 取消置顶', short: '置顶', tip: '管理员专属，全站生效' })
  }
  list.push({
    key: 'essence',
    label: '加精 / 取消加精',
    short: '加精',
    tip: admin ? '全站生效' : '仅限你负责的板块'
  })
  if (nonPublic) {
    list.push({ key: 'restore', label: '恢复公开', short: '恢复', tip: '恢复后所有访客可见' })
  } else {
    list.push({ key: 'hide', label: '隐藏帖子', short: '隐藏', tip: '隐藏后仅作者与管理员可见' })
  }
  return list
}

/**
 * 汇总当前用户的权限画像 —— 供「我的权限」卡片渲染。
 *
 * 优先级取**最高的那一个角色**展示（ADMIN > MODERATOR > USER），
 * 因为 `BadgeService` 也是这个口径（含 ADMIN 时不再显示「版主」）。
 *
 * @param {object} user 后端 `UserInfoVO`
 * @returns {{code:string,label:string,color:string,scope:string,can:string[]}}
 */
export function permissionSummary(user = {}) {
  const u = user || {}
  const roles = normalizeRoles(u.roles)

  if (roles.includes(ROLE.ADMIN)) {
    return {
      code: ROLE.ADMIN,
      label: '管理员',
      color: TONE.ADMIN,
      scope: '全站范围',
      can: [
        '管理全部板块的帖子和回复',
        '置顶 / 加精 / 隐藏 / 恢复 / 审核帖子',
        '处理全站举报，分配版主，管理用户与公告',
        '查看全站操作审计日志'
      ]
    }
  }

  if (roles.includes(ROLE.MODERATOR)) {
    const names = arr(u.moderatorBoardNames).filter((n) => typeof n === 'string' && n)
    return {
      code: ROLE.MODERATOR,
      label: '版主',
      color: TONE.MODERATOR,
      scope: names.length ? `负责板块：${names.join('、')}` : '暂未分配负责板块',
      can: [
        '审核（通过 / 驳回）负责板块的帖子',
        '加精 / 隐藏 / 恢复负责板块的帖子',
        '处理负责板块的举报',
        '（置顶与全站管理属管理员权限）'
      ]
    }
  }

  return {
    code: ROLE.USER,
    label: '普通用户',
    color: TONE.USER,
    scope: '仅本人内容',
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

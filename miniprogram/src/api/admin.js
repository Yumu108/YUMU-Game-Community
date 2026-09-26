/**
 * 管理 / 审核接口封装 —— 与主站「管理后台」**同一套后端接口**（`/admin/**`）。
 *
 * 小程序端**不复刻后台列表页**，只做「按角色显隐的轻量管理入口」：
 * 在帖子详情页给管理员 / 版主一个「管理」按钮，能置顶、加精、隐藏、恢复。
 * 这样「权限方案」在端内就有了**可操作的证据**，而不只是一个装饰性徽章。
 *
 * ══════════════════ 权限契约（2026-09-26 逐条核对 `AdminController`） ══════════════════
 *  ① 整个 `/admin/**` 在**类上**挂了 `@PreAuthorize("hasAnyRole('ADMIN','MODERATOR')")`。
 *     🚨 关键推论：**普通登录用户调用其中任意一个（包括下面的 can-review）都会拿到
 *        `code=403`「无权限（需要管理员角色）」**，而不是温和地返回 false。
 *        全局异常处理器把 `AccessDeniedException` 转成「HTTP 200 + code 403」
 *        （见 `GlobalExceptionHandler#handleAccessDenied`）。
 *     ⇒ 所以端内**必须先本地判角色**（`utils/store.js#isAdmin/isModerator`）再决定发不发请求，
 *       否则每个普通用户一进详情页就白挨一次 403。
 *
 *  ② `pin`（置顶）在方法上另有 `@PreAuthorize("hasRole('ADMIN')")` ⇒ **仅管理员**。
 *
 *  ③ `essence`（加精）/ `hide`（隐藏）/ `restore`（恢复）走服务端 `assertCanModeratePost`
 *     ⇒ 管理员全权；版主**仅限自己负责的 (游戏, 板块)**，越权抛 `BusinessException(403)`。
 *     注意这里的校验器是 `assertCanModeratePost`，**没有**「不能操作自己的帖子」这条 ——
 *     管理员 / 版主对自己辖区内的帖子照样能加精、隐藏。
 *
 *  ④ `approve`（审核通过）/ `reject`（驳回）走的是**另一个**校验器 `canReviewPost`
 *     ⇒ 它比 ③ 多一条「**自己不能审自己**」（`Post.getUserId().equals(viewerId) → false`）。
 *     所以「批准 / 驳回」按钮必须额外拿 `can-review` 的结果来使能，不能只看角色 ——
 *     否则管理员打开自己发的公告帖会看到一个点了必然 403 的按钮。
 *
 *  ⑤ `can-review` 是**唯一不会对版主抛错**的接口：版主不负责该游戏时返回
 *     `{canReview:false}`，正好当「按钮到底显不显示」的精确依据。
 *     后端注释原话：「单帖子审核权限预览：当前用户能否 review 这个帖子
 *     （前端『批准/驳回』按钮的使能依据）」。
 *
 * ⚠️ 请求层 `request.js` 在业务失败时会 toast `message` 原文。因此**允许失败**的探测类调用
 *    （can-review）必须传 `{ silent: true }`，否则用户会莫名看到红字「无权限（需要管理员角色）」。
 */
import { get, post, put } from './request'

/**
 * 当前用户能否审核 / 管理这篇帖子。
 *
 * @param {number} postId
 * @returns {Promise<{canReview:boolean}>} 失败时 reject（调用方按 false 处理即可）
 *
 * ⚠️ 只应由「已确认有 ADMIN/MODERATOR 角色」的调用方发起（见文件头推论 ①）。
 */
export const fetchCanReview = (postId) =>
  get(`/admin/posts/${postId}/can-review`, {}, { silent: true })

/** 置顶 / 取消置顶（**仅 ADMIN**，toggle 语义）→ `{isTop}` */
export const pinPost = (id) => post(`/admin/posts/${id}/pin`)

/** 加精 / 取消加精（ADMIN 全权；MODERATOR 限负责板块，toggle 语义）→ `{isEssence}` */
export const essencePost = (id) => post(`/admin/posts/${id}/essence`)

/** 隐藏帖子（status→1，ADMIN 或负责该板块的 MODERATOR） */
export const hidePost = (id) => post(`/admin/posts/${id}/hide`)

/** 恢复帖子（status→0，同上） */
export const restorePost = (id) => post(`/admin/posts/${id}/restore`)

/**
 * 审核通过（status→0）。
 *
 * ⚠️ 走 `canReviewPost` ⇒ **比加精/隐藏多一条「自己不能审自己」**。
 *    调用方必须先确认 `can-review` 为真，否则会拿到 403「无权审核该帖子」。
 */
export const approvePost = (id) => post(`/admin/posts/${id}/approve`)

/**
 * 驳回帖子（status→1 + 写驳回理由 + 通知发帖人）。
 *
 * @param {number} id
 * @param {string} reason 驳回理由（后端 `RejectPostRequest.reason`，`@Valid` 校验非空）
 * ⚠️ 同样走 `canReviewPost`（自己不能审自己）。
 *    理由**必填**：后端会把它写进驳回记录并推送给作者，空理由会被参数校验挡下。
 */
export const rejectPost = (id, reason) => post(`/admin/posts/${id}/reject`, { reason })

/**
 * 按动作 key 分发（供管理面板统一调用，避免页面里写一长串 if/else）。
 *
 * @param {'pin'|'essence'|'hide'|'restore'|'approve'|'reject'} key
 * @param {number} postId
 * @param {{reason?:string}} [payload] `reject` 需要 `reason`，其余忽略
 */
export function runManageAction(key, postId, payload = {}) {
  const TABLE = {
    pin: (id) => pinPost(id),
    essence: (id) => essencePost(id),
    hide: (id) => hidePost(id),
    restore: (id) => restorePost(id),
    approve: (id) => approvePost(id),
    reject: (id) => rejectPost(id, payload.reason)
  }
  const fn = TABLE[key]
  if (!fn) return Promise.reject(new Error(`未知的管理动作：${key}`))
  return fn(postId)
}

/* ══════════════════ 用户 / 角色管理（2026-09-26 新增，仅 ADMIN） ══════════════════
 *
 * 对应 `AdminUserController`（`@RequestMapping("/admin/users")`，**类级 `hasRole('ADMIN')`**）。
 * ⇒ 与帖子类接口（`hasAnyRole('ADMIN','MODERATOR')`）**不同**：这里版主也会 403。
 *   所以端内入口必须用 `utils/roles.js#canManageUsers`（只认 ADMIN）来把闸，
 *   不能用 `canSeeManageEntry`（那个含版主）。混用 = 版主点进去必吃 403。
 *
 * 与主站管理后台是**同一套接口**，端内只是换了个更轻的交互（搜索 → 编辑 → 保存）。
 * 后端零改动 —— 这些接口本来就存在（`/admin/users` 系列在主站已被使用）。
 */

/**
 * 搜索 / 分页列出用户。
 *
 * @param {string} keyword 关键词，**同时模糊匹配 `username` 与 `nickname`**
 *        （后端 `listUsers`：`like(username) OR like(nickname)`）；空串 = 不过滤
 * @param {{current?:number,size?:number}} [page] size 后端钳制在 1..100（默认 20）
 * @returns {Promise<{total:number,records:Array}>} 记录含 `roles` / `moderatorAssignments` / `status`
 *
 * ⚠️ 关键词走的是 LIKE `%kw%`，不是精确匹配 —— 搜「a」会命中所有含 a 的账号，
 *    所以 UI 上要如实写「模糊搜索」，别暗示是精确查找。
 */
export const fetchAdminUsers = (keyword = '', { current = 1, size = 20 } = {}) =>
  get('/admin/users', { keyword: keyword || undefined, current, size })

/**
 * 用户详情（含 `email` / `bio` / `moderatorAssignments`）。
 * 列表接口已带 `moderatorAssignments`，一般够用；需要完整资料时再调这个。
 */
export const fetchAdminUserDetail = (id) => get(`/admin/users/${id}`)

/**
 * 全量替换某用户的角色。
 *
 * 🚨 三条硬约束（都在后端 `updateUserRoles` 里）：
 *  ① `roles` **不能为空**（`@NotEmpty`）—— 想把管理员降为普通用户时，
 *     必须传 `['USER']`，传 `[]` 会被 400 挡下；
 *  ② 角色 code 必须在 `role` 表里（USER / MODERATOR / ADMIN），写错报「存在无效角色」；
 *  ③ **若新角色不含 MODERATOR，后端会顺带清空他的版主授权**
 *     （`if (!roleCodes.contains("MODERATOR")) setModeratorBoards(userId, [])`）。
 *     ⇒ 所以「取消版主」不需要额外调一次 moderator-boards，那是后端的事。
 *
 * @param {number} id
 * @param {string[]} roles 角色 code 列表，如 `['USER','MODERATOR']`
 */
export const updateUserRoles = (id, roles) => put(`/admin/users/${id}/roles`, { roles })

/**
 * 设置版主负责的游戏（**全量替换**）。
 *
 * 🚨 `MAX_GAMES_PER_MOD = 1` —— **一名版主只能负责一个游戏**，
 *    提交多于 1 个会被 400 挡下（「请只选择目标游戏」）。
 *    换任时只提交目标游戏即可，旧授权会被物理删除。
 * 🚨 `MAX_MODS_PER_GAME = 5` —— 单个游戏最多 5 名版主，超了报错。
 * ⚠️ `boardId` 字段已废弃（后端统一置 NULL 表示「负责该游戏全部板块」），
 *    这里只传 `gameId`，别传 boardId。
 *
 * @param {number} id
 * @param {number[]} gameIds 游戏 id 列表（业务上只会有 0 或 1 个）
 */
export const setModeratorBoards = (id, gameIds = []) =>
  put(`/admin/users/${id}/moderator-boards`, {
    items: (gameIds || []).filter((g) => g != null).map((g) => ({ gameId: g }))
  })

/*
 * ⚠️ 后端 `/admin/users/**` 还有几个本页**故意没接**的接口，别以为漏了：
 *   · `PUT /{id}/status`（封禁 / 解封）—— 属于「账号管控」不是「权限分配」，
 *     放进来会让这个页面的职责变糊（一个页面干两件事，确认弹窗文案也没法统一）。
 *   · `PUT /{id}/profile`、`PUT /{id}/reset-password`、`DELETE /{id}` —— 同上，
 *     而且重置密码会返回**口令明文**，在手机端展示风险更高，留给主站。
 *   判断依据很简单：**改权限 = 改这个人能做什么**，其余都属于资料/账号管控。
 */

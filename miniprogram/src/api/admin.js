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
 *
 *  ④ `can-review` 是**唯一不会对版主抛错**的接口：版主不负责该板块时返回
 *     `{canReview:false}`，正好当「按钮到底显不显示」的精确依据。
 *     后端注释原话：「单帖子审核权限预览：当前用户能否 review 这个帖子
 *     （前端『批准/驳回』按钮的使能依据）」。
 *
 * ⚠️ 请求层 `request.js` 在业务失败时会 toast `message` 原文。因此**允许失败**的探测类调用
 *    （can-review）必须传 `{ silent: true }`，否则用户会莫名看到红字「无权限（需要管理员角色）」。
 */
import { get, post } from './request'

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
 * 按动作 key 分发（供管理面板统一调用，避免页面里写一长串 if/else）。
 *
 * @param {'pin'|'essence'|'hide'|'restore'} key
 * @param {number} postId
 */
export function runManageAction(key, postId) {
  const TABLE = {
    pin: pinPost,
    essence: essencePost,
    hide: hidePost,
    restore: restorePost
  }
  const fn = TABLE[key]
  if (!fn) return Promise.reject(new Error(`未知的管理动作：${key}`))
  return fn(postId)
}

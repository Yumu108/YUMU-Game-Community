/**
 * 「登录已过期，请重新登录」提示的**全局收口**（9-16）。
 *
 * 背景（用户反馈）：退出登录 / 每次进入网站时经常连飘好几条红条，很影响观感。
 * 排查后有两条独立成因，都在这里解决：
 *
 *  ① **并发刷屏**：首屏一批请求（板块 / 帖子 / 未读数 / 积分…）是并发发出的，
 *     token 一旦不可用，每个 401 都会各自弹一条 → 屏幕上同时堆 2~3 条同样的红条。
 *     → 用 `claimAuthToast()` 做窗口去重：2 秒内只放行第一条。
 *
 *  ② **主动退出后的"余波"**：点「退出登录」时已把 jti 拉黑，
 *     但此刻仍在途的请求还带着这张刚失效的 token，回来就是 401。
 *     用户明明是自己退出的，却被指责"登录已过期"。
 *     → 退出时开一个静默窗口（`silenceAuthToast()`），窗口内一律不弹。
 *
 * ⚠️ 只影响**提示**，不影响登出清理：`clearLocalAuth()` 照常执行，
 *    否则会留下"提示没了但登录态还在"的脏状态。
 */

/** 同类提示的最小间隔：窗口内的后续 401 不再弹（并发合并成一条）。 */
const TOAST_GAP_MS = 2000

/** 静默截止时间戳（主动登出等"用户已知情"的场景使用）。 */
let silentUntil = 0

/** 上一次真正弹出提示的时间戳。 */
let lastToastAt = 0

/**
 * 进入静默窗口：窗口内不再弹「登录已过期」。
 *
 * @param {number} [ms] 静默时长（毫秒），默认 5s ——
 *   足够覆盖"退出登录 → 跳转登录页 → 页面在途请求陆续返回"这段过程。
 */
export function silenceAuthToast(ms = 5000) {
  silentUntil = Date.now() + ms
}

/**
 * 申请一次弹提示的机会（**有副作用**：抢到就立刻占用时间窗）。
 *
 * 调用方拿到 true 才弹；返回 false 表示"刚刚已经弹过了"或"正处于静默窗口"。
 * 故意把"判断 + 占位"合成一步，避免两个并发 401 同时通过判断后各弹一条。
 *
 * @returns {boolean}
 */
export function claimAuthToast() {
  const now = Date.now()
  if (now < silentUntil) return false
  if (now - lastToastAt < TOAST_GAP_MS) return false
  lastToastAt = now
  return true
}

/** 测试/调试用：重置内部状态。 */
export function resetAuthToast() {
  silentUntil = 0
  lastToastAt = 0
}

/**
 * 登录门禁 —— 「游客只读，动数据先登录」这条口径的**唯一收口处**。
 *
 * ── 口径（2026-09-21 用户明确）────────────────────────────────────
 *   游客（未登录）**只能看**：攻略 / 资讯 / 游戏库 / 搜索 / 帖子详情 + **浏览历史**。
 *   点赞、收藏、举报这类「会写数据、且要算在某个账号头上」的动作，一律先登录。
 *   分享**不设门禁** —— 它不写数据也不绑身份，保留给游客（对内容展示端是利好）。
 *
 * ── 为什么要单独一个文件 ────────────────────────────────────────
 *   原先每个入口各写一份「没登录就 toast + navigateTo」的代码（举报是最早的一份），
 *   这类复制体最容易走偏：文案不一致、有的忘了 `return`、有的没跳登录页。
 *   收口成一个函数后，**新加入口只需要一行 `if (!requireLogin('xx 需要先登录')) return`**。
 *
 * ⚠️ 这里刻意只 import `utils/store`（它依赖 `api/config` 的条件编译块），
 *   因此本文件**不能在普通 Node 里单测** —— 与 `utils/apiGuard.js`（零 import、可单测）
 *   的分工不同。门禁的验证走 `tests/verify-miniprogram.cjs` 的端到端断言（M 组）。
 */
import { getUser } from './store'

/** 是否已登录（与主站同一套账号 / token，见 utils/store.js 的会话段） */
export function isLoggedIn() {
  return !!getUser()
}

/**
 * 未登录时拦下动作：**提示 + 跳登录页**，返回 false 让调用方 `return`。
 *
 * 为什么不是「先跳登录、不提示」：直接跳页会让人以为点错了；
 * 为什么不是「只提示不跳」：用户还得自己找登录入口（此处正是之前的举报体验问题）。
 * 两者都做，并且**先提示再跳**（`navigateTo` 会盖住 toast，所以要延时）。
 *
 * @param {string} [tip] 提示文案，如「点赞需要先登录」
 * @returns {boolean} true = 已登录，可以继续
 */
export function requireLogin(tip) {
  if (getUser()) return true
  uni.showToast({ title: tip || '登录后才能使用该功能', icon: 'none', duration: 1800 })
  setTimeout(() => {
    uni.navigateTo({ url: '/pages/login/login' })
  }, 700)
  return false
}

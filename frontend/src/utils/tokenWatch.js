/**
 * token 续签的"后台巡检"（9-10）。
 *
 * 请求拦截器只覆盖"有请求发生时"的续签；如果用户长时间停留在某个页面不发请求
 * （比如看着一篇长贴不再操作），定时器也保证会话是活的。
 *
 * 三件事：
 *  1) 每 15 分钟检查一次：token 剩余不足 30 分钟就静默续签（阈值 2 倍余量，失败还有下一次机会）；
 *  2) 回到前台（visibilitychange / focus）补一次 —— 浏览器会节流后台标签页的定时器；
 *  3) 跨标签页同步：另一个标签续签或登出后，通过 storage 事件同步本标签的状态。
 */
import { useUserStore } from '@/store'
import { isExpiringSoon } from '@/utils/tokenAuth'

/** 巡检间隔：15 分钟。 */
const CHECK_INTERVAL_MS = 15 * 60 * 1000

export function setupTokenWatch() {
  const userStore = useUserStore()

  const tryRenew = () => {
    if (!userStore.token || !isExpiringSoon(userStore.token)) return
    userStore.refreshToken().catch(() => {
      // 续签失败（多为 token 已过期）—— 交由请求拦截器统一处理提示与登出，这里不重复弹错
    })
  }

  // 1) 定时巡检（加 0~60s 抖动：避免多个标签页在同一毫秒同时续签导致 token 互相轮换）
  setInterval(tryRenew, CHECK_INTERVAL_MS + Math.floor(Math.random() * 60_000))

  // 2) 回到前台补检
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tryRenew()
  })
  window.addEventListener('focus', tryRenew)

  // 3) 跨标签页同步（storage 事件只在"其他"标签页触发）
  window.addEventListener('storage', (e) => {
    if (e.key === 'token') userStore.syncTokenFromStorage(e.newValue)
  })

  // 启动即检一次（覆盖"上次关闭时 token 已临期"的情况）
  tryRenew()
}

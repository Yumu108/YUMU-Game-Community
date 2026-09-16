import { defineStore } from 'pinia'
import request from '../api/request'
import { isExpired } from '../utils/tokenAuth'
import { silenceAuthToast } from '../utils/authToast'

export { useGameStore } from './game'

/**
 * 续签单飞（single-flight）：多个并发请求同时发现 token 临期时，
 * 只发一次 /auth/refresh，其余请求复用同一个 Promise —— 否则会互相把对方的
 * token 轮换进黑名单（后端每次续签都会作废旧 jti）。
 */
let refreshPromise = null

export const useUserStore = defineStore('user', {
  state: () => {
    // 🚨 9-16「进站即检」：上一次会话留下的 token 若**已经过期**（隔天再打开网站是最常见的场景，
    //    access token 只有 2h），直接按"未登录"处理并把残留清掉，**不弹任何提示**。
    //
    //    修复前：死 token 一直躺在 localStorage 里，首屏那批并发请求（板块 / 帖子 / 未读数…）
    //    全部带着它去撞 401 → 每个都弹一条「登录已过期，请重新登录」→
    //    用户看到的就是"每次进网站都飘红，还一次飘好几条"。
    //    用户并没有"被踢出"，只是上次会话早结束了 —— 这种情况不该报错，安静地回到未登录态即可。
    const storedToken = localStorage.getItem('token') || ''
    if (storedToken && isExpired(storedToken)) {
      localStorage.removeItem('token')
      localStorage.removeItem('userInfo')
      return { token: '', userInfo: null, points: 0, signedToday: false, unreadCount: 0 }
    }
    return {
      token: storedToken,
      userInfo: JSON.parse(localStorage.getItem('userInfo') || 'null'),
      // 积分 / 签到：TopBar（💎 + 签到按钮）与 My.vue（积分卡片）共享同一份状态，
      // 一边签到成功立刻反映到另一边，无需路由切换刷新。
      points: 0,
      signedToday: false,
      // 通知未读数：TopBar 铃铛与 Notifications.vue 共享，标记已读后即时减数/清零。
      unreadCount: 0
    }
  },
  getters: {
    isLoggedIn: (state) => !!state.token,
    isAdmin: (state) =>
      Array.isArray(state.userInfo?.roles) && state.userInfo.roles.includes('ADMIN'),
    isModerator: (state) =>
      Array.isArray(state.userInfo?.roles) && state.userInfo.roles.includes('MODERATOR'),
    canModerate: (state) =>
      Array.isArray(state.userInfo?.roles) &&
      (state.userInfo.roles.includes('ADMIN') || state.userInfo.roles.includes('MODERATOR'))
  },
  actions: {
    setToken(token) {
      this.token = token
      localStorage.setItem('token', token)
    },
    setUserInfo(info) {
      this.userInfo = info
      localStorage.setItem('userInfo', JSON.stringify(info))
    },
    /**
     * 同步积分 + 今日签到状态。
     * @param {{points?:number, signedToday?:boolean}} s
     */
    setSignStatus(s = {}) {
      if (s.points != null) this.points = s.points
      if (s.signedToday != null) this.signedToday = !!s.signedToday
    },
    /**
     * 同步通知未读数。
     * @param {number} n
     */
    setUnreadCount(n) {
      this.unreadCount = Math.max(0, n | 0)
    },
    async logout() {
      // A3：先通知服务端把当前 jti 加入黑名单（即便 token 2h 内过期，黑名单也强制立即失效）；
      // 调用失败（断网/已过期）不影响本地清理，避免影响用户退出体验。
      // _skipRenew：登出请求不走"临期续签 / 401 重试"逻辑，否则会与续签互相递归。
      // 🚨 9-16：进静默窗口 —— 用户是**自己**点的退出，此刻仍在途的请求（未读数 / 通知 / 积分…）
      //    还带着刚被拉黑的 token，回来必然是 401。若不静默，用户会在"已退出登录"的绿条旁边
      //    又看到几条「登录已过期，请重新登录」的红条，像是被系统指责。
      silenceAuthToast()
      try {
        await request.post('/auth/logout', null, { _skipRenew: true })
      } catch (_) {
        // 网络异常 / token 已过期 —— 静默忽略，本地仍按退出处理
      }
      this.clearLocalAuth()
    },
    /** 仅清本地登录态（不调服务端）。供 401 兜底、跨标签页登出同步使用。 */
    clearLocalAuth() {
      this.token = ''
      this.userInfo = null
      this.points = 0
      this.signedToday = false
      this.unreadCount = 0
      localStorage.removeItem('token')
      localStorage.removeItem('userInfo')
    },
    /**
     * 9-10 token 滑动续签：用当前（仍有效）的 token 换一张新的 2h token。
     * 并发调用只发一次请求（single-flight）；失败即抛出，由调用方决定是否登出。
     * @returns {Promise<string>} 新 token
     */
    refreshToken() {
      if (!this.token) return Promise.reject(new Error('未登录'))
      if (!refreshPromise) {
        refreshPromise = request
          .post('/auth/refresh', null, { _skipRenew: true })
          .then((res) => {
            // ⚠️ request 响应拦截器已把响应脱壳一层（res = {code,message,data}），
            // 所以这里必须取 res.data.token —— 写成 res.token 会拿到 undefined，
            // 而服务端此时已经把旧 jti 拉黑（轮换成功但前端没接住新 token）→ 后续全部 401 被登出。
            const token = res?.data?.token
            if (!token) throw new Error('续签失败')
            this.setToken(token)
            return token
          })
          .catch((err) => {
            // 续签失败时兜底：localStorage 里若已有更新的 token（并发请求或另一个标签页刚续签过），
            // 直接采用它 —— 避免"我拿旧 token 去续签，但旧 jti 已被别人轮换拉黑"导致误登出
            const stored = localStorage.getItem('token')
            if (stored && stored !== this.token) {
              this.token = stored
              return stored
            }
            throw err
          })
          .finally(() => {
            refreshPromise = null
          })
      }
      return refreshPromise
    },
    /** 跨标签页：另一个标签续签/登出后，由 storage 事件同步本地状态。 */
    syncTokenFromStorage(token) {
      if (token && token !== this.token) {
        this.token = token
      } else if (!token) {
        this.clearLocalAuth()
      }
    }
  }
})

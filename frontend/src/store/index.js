import { defineStore } from 'pinia'
import request from '../api/request'

export { useGameStore } from './game'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    userInfo: JSON.parse(localStorage.getItem('userInfo') || 'null'),
    // 积分 / 签到：TopBar（💎 + 签到按钮）与 My.vue（积分卡片）共享同一份状态，
    // 一边签到成功立刻反映到另一边，无需路由切换刷新。
    points: 0,
    signedToday: false,
    // 通知未读数：TopBar 铃铛与 Notifications.vue 共享，标记已读后即时减数/清零。
    unreadCount: 0
  }),
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
      try {
        await request.post('/auth/logout')
      } catch (_) {
        // 网络异常 / token 已过期 —— 静默忽略，本地仍按退出处理
      }
      this.token = ''
      this.userInfo = null
      this.points = 0
      this.signedToday = false
      this.unreadCount = 0
      localStorage.removeItem('token')
      localStorage.removeItem('userInfo')
    }
  }
})

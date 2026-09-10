/**
 * 实时通知 WebSocket 管理器（单例）。
 *
 * 约定：
 * - 端点：/api/ws（context-path=/api，开发环境经由 Vite 代理 ws:true 透传，生产环境由 Nginx 升级转发）
 * - 鉴权：握手阶段在 URL 查询串携带 ?token=JWT（浏览器原生 WS 无法自定义请求头）
 * - 协议：服务端单向推送，客户端仅发心跳 {"type":"ping"}；服务端回 {"type":"pong"}
 * - 重连：指数退避（1s→15s 上限），用户主动 close 后不再重连
 *
 * 使用方：
 *   import { wsManager } from '@/utils/websocket'
 *   wsManager.connect(token)        // 登录后
 *   const off = wsManager.onMessage(fn) // 订阅，返回取消函数
 *   wsManager.close()               // 退出登录
 */

const WS_PATH = '/api/ws'

class WsManager {
  constructor() {
    this.ws = null
    this.token = null
    this.listeners = new Set()
    this.connected = false
    this.userClose = false
    this._reconnectTimer = null
    this._heartbeatTimer = null
    this._delay = 1000
  }

  /** 建立连接。token 为空直接忽略。 */
  connect(token) {
    if (!token) return
    this.token = token
    this.userClose = false
    this._open()
  }

  _open() {
    if (typeof WebSocket === 'undefined') return
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return // 正在连接/已连接
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}${WS_PATH}?token=${encodeURIComponent(this.token)}`
    let ws
    try {
      ws = new WebSocket(url)
    } catch (e) {
      this._scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.connected = true
      this._delay = 1000
      this._startHeartbeat()
      this._emit({ type: 'status', connected: true })
    }
    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch (e) {
        return
      }
      if (!msg || msg.type === 'pong') return
      this._emit(msg)
    }
    ws.onclose = () => {
      this.connected = false
      this._stopHeartbeat()
      this._emit({ type: 'status', connected: false })
      if (!this.userClose) this._scheduleReconnect()
    }
    ws.onerror = () => {
      // close 事件会紧随触发，统一在 onclose 处理重连
      try { ws.close() } catch (e) { /* ignore */ }
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat()
    // 25s 一次心跳，低于常见 60s 反向代理超时，保活链路
    this._heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        try { this.ws.send(JSON.stringify({ type: 'ping' })) } catch (e) { /* ignore */ }
      }
    }, 25000)
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer || this.userClose) return
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      if (!this.userClose) this._open()
    }, this._delay)
    this._delay = Math.min(Math.round(this._delay * 1.6), 15000)
  }

  /** 订阅消息，返回取消订阅函数。 */
  onMessage(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  _emit(msg) {
    this.listeners.forEach((fn) => {
      try { fn(msg) } catch (e) { /* 单个订阅者异常不影响其他 */ }
    })
  }

  /** 主动关闭（退出登录时调用）：停止重连与心跳。 */
  close() {
    this.userClose = true
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    this._stopHeartbeat()
    if (this.ws) {
      try { this.ws.close() } catch (e) { /* ignore */ }
      this.ws = null
    }
    this.connected = false
  }

  isConnected() {
    return this.connected
  }
}

export const wsManager = new WsManager()

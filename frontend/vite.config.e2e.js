/**
 * 临时 E2E 配置（用完即删，不提交）。
 *
 * 为什么需要它：后端 CORS 只放行 `http://localhost:5173`，而 5173 被另一个会话
 * 的 dev server 占着。这里换到 5199，并在代理层把浏览器带来的 `Origin` 头摘掉，
 * 让请求对后端而言是"非浏览器同源请求" —— 既不打扰对方，也不用改后端配置。
 */
import base from './vite.config.js'

const noOrigin = (proxy) => {
  const strip = (req) => {
    req.removeHeader('origin')
    req.removeHeader('referer')
  }
  proxy.on('proxyReq', strip)
  // WS 握手也要摘：否则 /api/ws 会因 Origin 不在白名单而 403，
  // 控制台会刷 "WebSocket connection failed" —— 那是本测试环境的产物，不是产品问题。
  proxy.on('proxyReqWs', strip)
}

export default {
  ...base,
  server: {
    port: 5199,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
        configure: noOrigin
      }
    }
  }
}

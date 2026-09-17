import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

/** 线上后端（宝塔 + Docker，context-path = /api） */
const API_TARGET = 'http://8.133.255.202'

/**
 * H5 部署形态：编到现有服务器 http://8.133.255.202/m/ 下（见 src/manifest.json 的 h5.router.base）。
 * 与后端**同源**，因此请求层用相对路径 `/api` 即可，无需改后端 CORS 白名单。
 *
 * 开发期：本机 5174 起的 dev server 把 /api 代理到线上后端，
 * 既避开跨域，也省掉把 localhost 加进 CORS_ALLOWED_ORIGINS 的麻烦。
 */
export default defineConfig({
  plugins: [uni()],
  server: {
    host: 'localhost',
    port: 5174,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true
      }
    }
  }
})

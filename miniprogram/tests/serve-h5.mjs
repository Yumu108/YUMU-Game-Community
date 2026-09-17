/**
 * 产物验证用的最小静态服务器 —— 把 `dist/build/h5` 挂在 `/m/` 下，并把 `/api` 代理到线上后端。
 *
 * 为什么要自己起：H5 产物里请求走的是**相对路径** `/api`（与后端同源假设），
 * 用普通静态服务器打开会因为「没有 /api」而全页空数据。
 * 这里补上代理，就能在**本地验证真实生产产物**（而不是只验证 dev server）。
 *
 * 运行：node tests/serve-h5.mjs   → http://localhost:5199/m/
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../dist/build/h5')
const API_TARGET = process.env.API_TARGET || 'http://8.133.255.202'
const PORT = Number(process.env.PORT || 5199)
const BASE = '/m'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
}

/**
 * 🚨 复刻**生产 nginx 的安全响应头**（与 deploy/nginx/security-headers.conf 保持一致）。
 *
 * 为什么本地必须带上：CSP `script-src 'self'` 会**拒绝内联脚本**。本地若不加这层约束，
 * 产物里的内联脚本在本地全绿、一上线就被拦 —— 2026-09-17 正是这样漏掉了 uni-app H5
 * 模板里的内联 viewport 脚本，后果是**真机上没有 viewport meta、移动端按桌面宽度渲染**。
 * 此类「只在生产暴露」的差异，就该在本地复现，而不是等上线后才发现。
 *
 * ⚠️ 改了 deploy/nginx/security-headers.conf 时，这里要同步改（两份必须一致）。
 */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=(), payment=()',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' ws: wss:; media-src 'self' blob: https:; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
}

if (!fs.existsSync(ROOT)) {
  console.error(`❌ 产物不存在：${ROOT}\n   先跑 npm run build:h5`)
  process.exit(1)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // ---- /api 反向代理到线上后端 ----
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    try {
      // 不转发原始 Host，由 fetch 按目标 URL 生成，避免被按 Host 头拦（未备案域名场景）
      const r = await fetch(API_TARGET + url.pathname + url.search, {
        method: req.method,
        headers: { accept: req.headers.accept || '*/*' },
        signal: AbortSignal.timeout(25000)
      })
      res.writeHead(r.status, {
        ...SECURITY_HEADERS,
        'content-type': r.headers.get('content-type') || 'application/json; charset=utf-8'
      })
      res.end(Buffer.from(await r.arrayBuffer()))
    } catch (e) {
      res.writeHead(502, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ code: 502, message: 'proxy error: ' + e.message }))
    }
    return
  }

  // ---- 静态文件：/m/xxx → dist/build/h5/xxx ----
  let p = url.pathname
  if (p === BASE || p === BASE + '/') p = `${BASE}/index.html`
  if (!p.startsWith(`${BASE}/`)) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found (only /m/ is served)')
    return
  }

  const rel = decodeURIComponent(p.slice(BASE.length + 1))
  const file = path.join(ROOT, rel)
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }

  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
  })
  res.end(fs.readFileSync(file))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`▶ 已启动：http://localhost:${PORT}${BASE}/`)
  console.log(`  静态根：${ROOT}`)
  console.log(`  /api  →  ${API_TARGET}`)
})

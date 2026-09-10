// Phase 6 验证脚本：Redis 优雅降级 + 图片上传->URL->静态访问
// 用法：node phase6-verify.mjs
const BASE = 'http://localhost:8080/api'

function assert(cond, msg) {
  if (!cond) { console.error('  ✗ FAIL:', msg); process.exitCode = 1 }
  else console.log('  ✓', msg)
}

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

async function main() {
  console.log('\n[1] 缓存模式（Redis 优雅降级）')
  let r = await fetch(`${BASE}/system/cache-mode`)
  let j = await r.json()
  console.log('   ', JSON.stringify(j))
  assert(r.status === 200 && j.code === 200, 'GET /system/cache-mode 返回 200')
  assert(j.data && (j.data.mode === 'local' || j.data.mode === 'redis'), `mode=${j.data?.mode}（本机无 Redis 应为 local）`)

  console.log('\n[2] Stats 热点接口（走缓存）')
  r = await fetch(`${BASE}/stats/hot-posts?limit=8`)
  j = await r.json()
  assert(r.status === 200 && j.code === 200, 'GET /stats/hot-posts 返回 200')
  assert(Array.isArray(j.data) && j.data.length > 0, `返回 ${j.data?.length} 条热门帖`)

  console.log('\n[3] 上传需登录（未授权应 401）')
  r = await fetch(`${BASE}/upload`, { method: 'POST', body: new FormData() })
  j = await r.json()
  // 本项目未授权由 AuthenticationEntryPoint 返回 HTTP 401 + body{code:401}
  assert(r.status === 401 && j.code === 401, `未携带 JWT 上传返回 HTTP 401 / code=401（实际 ${r.status}/${j.code}）`)

  console.log('\n[4] 注册->登录->上传图片->访问 URL')
  const uname = 'phase6_' + Date.now()
  r = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uname, password: 'test1234', nickname: 'P6' })
  })
  j = await r.json()
  assert(r.status === 200 && j.code === 200 && j.data?.token, '注册成功并取得 token')
  const token = j.data.token

  // 构造 multipart 图片
  const buf = Buffer.from(PNG_B64, 'base64')
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: 'image/png' }), 'pixel.png')
  r = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd
  })
  j = await r.json()
  console.log('   上传返回:', JSON.stringify(j))
  assert(r.status === 200 && j.code === 200, '已登录上传返回 200')
  const url = j.data
  assert(typeof url === 'string' && url.startsWith('/api/files/'), `返回可访问 URL: ${url}`)

  console.log('\n[5] 访问上传后的图片（静态资源映射 /files/**）')
  r = await fetch(`http://localhost:8080${url}`)
  const ct = r.headers.get('content-type')
  const ab = await r.arrayBuffer()
  assert(r.status === 200, `GET ${url} 返回 200（实际 ${r.status}）`)
  assert(ct && ct.startsWith('image/'), `响应 Content-Type=${ct}`)
  assert(ab.byteLength === buf.length, `图片字节数一致（${ab.byteLength} bytes）`)

  console.log('\n[6] 非图片文件应被拒绝（400）')
  const fd2 = new FormData()
  fd2.append('file', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'x.txt')
  r = await fetch(`${BASE}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd2 })
  j = await r.json()
  assert(j.code === 400, `上传非图片返回 400（实际 code=${j.code}）`)

  console.log('\n[7] 发帖携带上传图片 URL（端到端）')
  // 取一个板块
  r = await fetch(`${BASE}/boards`)
  j = await r.json()
  const board = j.data?.flatMap(b => [b, ...(b.children || [])])?.[0]
  r = await fetch(`${BASE}/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'P6 上传图测试',
      boardId: board?.id,
      content: `正文带图 ![图片](${url})`,
      cover: url,
      tags: ['测试']
    })
  })
  j = await r.json()
  console.log('   发帖返回:', JSON.stringify(j).slice(0, 200))
  assert(r.status === 200 && j.code === 200 && j.data?.id, '发帖成功（封面/正文引用上传 URL）')

  console.log('\n=== Phase 6 验证结束 ===')
}

main().catch(e => { console.error('脚本异常:', e); process.exit(1) })

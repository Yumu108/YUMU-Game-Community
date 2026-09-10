// 用法：node tests/approve-pending-posts.mjs
// 作用：以 ADMIN 身份将全部待审核(status=2)帖子批准发布(status=0)，
//       使种子帖子对全体用户可见，并同步板块/游戏帖子计数。
const BASE = process.env.YUMU_HOST || 'http://localhost:8080/api'

async function jfetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (data && typeof data === 'object') return { status: res.status, ...data }
  return { status: res.status, data }
}
async function login(u, p) {
  const r = await jfetch('/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) })
  if (r.code !== 200) throw new Error(`login fail: ${r.message}`)
  return r.data.token
}

let ok = 0, fail = 0
async function main() {
  const tok = await login('admin', 'admin123456')
  const auth = { Authorization: `Bearer ${tok}` }

  // 翻页收集所有待审帖 id
  const ids = []
  let cur = 1
  while (true) {
    const r = await jfetch(`/admin/posts?status=2&current=${cur}&size=100`, { headers: auth })
    const recs = r.data?.records || []
    for (const p of recs) if (p && p.id) ids.push(p.id)
    const total = r.data?.total || 0
    const pages = r.data?.pages || 1
    if (cur >= pages || recs.length === 0) break
    cur++
    if (ids.length >= total && total > 0) break
  }
  console.log(`待审帖子总数：${ids.length}`)
  if (ids.length === 0) { console.log('无需批准。'); return }

  for (const id of ids) {
    const r = await jfetch(`/admin/posts/${id}/approve`, { method: 'POST', headers: auth })
    if (r.code === 200) ok++
    else { fail++; console.log(`  ✗ #${id}: ${r.message || JSON.stringify(r.data)}`) }
  }
  console.log(`批准完成：成功 ${ok}，失败 ${fail}`)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })

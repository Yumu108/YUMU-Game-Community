// 用法：node tests/cleanup-test-posts.mjs
// 作用：删除历史自动化测试遗留的"脏数据"帖子（ws/搜索/加精/获赞等测试产物），
//       保持演示社区内容整洁。走 DELETE /posts/{id}（admin），计数自动同步。
const BASE = process.env.YUMU_HOST || 'http://localhost:8080/api'
// 精确列出待删的测试遗留帖 id（已核对，全部为测试产物，无真实内容）
const IDS = [
  // ws-like 推送测试帖
  3056, 3068, 3074, 3079, 3087, 3096,
  // 审核/隐藏测试相关 admin 帖
  3062, 3097, 3098, 3099,
  // 获赞/加精只发一次测试帖
  3103, 3104,
  // search 专项测试帖（含待审/隐藏变体）
  3105, 3106, 3107, 3108, 3109, 3110, 3111, 3112, 3113, 3114,
  3120, 3121, 3122, 3123, 3124, 3125, 3126, 3127, 3128, 3129
]

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
  const tok = await login('admin', (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME'))
  const auth = { Authorization: `Bearer ${tok}` }
  for (const id of IDS) {
    const r = await jfetch(`/posts/${id}`, { method: 'DELETE', headers: auth })
    if (r.code === 200) ok++
    else { fail++; console.log(`  ✗ #${id}: ${r.message || JSON.stringify(r.data)}`) }
  }
  console.log(`清理完成：成功删除 ${ok}，失败 ${fail}`)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })

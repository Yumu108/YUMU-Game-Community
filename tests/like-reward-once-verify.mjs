// 用法：node tests/like-reward-once-verify.mjs
// 验证（2026-09-03 bug 修复）：获赞奖励对同一 (帖子, 点赞人) 终身只加一次积分。
// 场景：admin 发帖 → A 点赞(+1) → A 取消(不变) → A 再赞(不得分，核心) → B 首赞(+1)
const BASE = process.env.YUMU_HOST || 'http://localhost:8080/api'
const rnd = () => 'lrw' + Date.now().toString(36) + Math.floor(Math.random() * 10000)

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
async function register(username) {
  const r = await jfetch('/auth/register', { method: 'POST', body: JSON.stringify({ username, password: 'pass123456', nickname: '获赞去重测试' }) })
  if (r.code !== 200) throw new Error(`register fail: ${r.message}`)
  return login(username, 'pass123456')
}

let passed = 0, failed = 0
function assert(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label) }
  else { failed++; console.log('  ✗ ' + label) }
}

async function main() {
  console.log('═'.repeat(60))
  console.log('获赞奖励只发一次 验证（取消再赞不重复加分）')
  console.log('═'.repeat(60))

  // 作者 = admin（发帖直发 status=0）
  const adminTok = await login('admin', 'admin123456')
  const adminAuth = { Authorization: `Bearer ${adminTok}` }

  // 两个一次性点赞用户
  const nameA = rnd() + 'a', nameB = rnd() + 'b'
  const tokA = await register(nameA)
  const tokB = await register(nameB)
  const authA = { Authorization: `Bearer ${tokA}` }
  const authB = { Authorization: `Bearer ${tokB}` }
  assert(!!tokA && !!tokB, `注册点赞用户 ${nameA} / ${nameB}`)

  // admin 发帖
  const post = await jfetch('/posts', {
    method: 'POST', headers: adminAuth,
    body: JSON.stringify({ boardId: 1, gameId: 2, title: '获赞奖励只发一次-' + nameA, content: 'test content' })
  })
  const pid = post.data?.id
  assert(post.code === 200 && pid, `admin 发帖 id=${pid}`)

  const authorPoints = async () => {
    const s = await jfetch('/points/status', { headers: adminAuth })
    return s.data?.totalPoints ?? -1
  }
  const like = async (auth) => {
    const r = await jfetch(`/posts/${pid}/like`, { method: 'POST', headers: auth })
    return r.data || {}
  }

  const p0 = await authorPoints()
  console.log(`\n作者起始积分 = ${p0}`)

  console.log('\n[1] A 首次点赞 → 作者 +1')
  let r = await like(authA)
  assert(r.liked === true && r.likeCount === 1, `点赞成功 likeCount=${r.likeCount}`)
  const p1 = await authorPoints()
  assert(p1 - p0 === 1, `作者积分 +1（${p0} → ${p1}）`)

  console.log('\n[2] A 取消点赞 → 不扣分')
  r = await like(authA)
  assert(r.liked === false && r.likeCount === 0, `取消成功 likeCount=${r.likeCount}`)
  const p2 = await authorPoints()
  assert(p2 === p1, `取消点赞不扣分（${p1} → ${p2}）`)

  console.log('\n[3] A 再次点赞 → 不再加分（核心修复点）')
  r = await like(authA)
  assert(r.liked === true && r.likeCount === 1, `再赞成功 likeCount=${r.likeCount}`)
  const p3 = await authorPoints()
  assert(p3 === p2, `二次点赞积分不变（${p2} → ${p3}）`)

  console.log('\n[4] A 取消，B 首次点赞 → 作者 +1（不同赞人仍正常奖励）')
  await like(authA)
  r = await like(authB)
  assert(r.liked === true && r.likeCount === 1, `B 点赞成功 likeCount=${r.likeCount}`)
  const p4 = await authorPoints()
  assert(p4 - p3 === 1, `B 首赞作者 +1（${p3} → ${p4}）`)

  console.log('\n[5] B 取消再赞 → 不再加分')
  await like(authB)
  r = await like(authB)
  assert(r.liked === true && r.likeCount === 1, `B 再赞成功 likeCount=${r.likeCount}`)
  const p5 = await authorPoints()
  assert(p5 === p4, `B 二次点赞积分不变（${p4} → ${p5}）`)

  console.log('\n' + '═'.repeat(60))
  console.log(`结果：${passed} 通过 / ${failed} 失败`)
  console.log('═'.repeat(60))
  if (failed) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })

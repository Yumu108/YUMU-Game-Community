// 用法：node tests/essence-reward-once-verify.mjs
// 验证（2026-09-02 bug 修复）：帖子反复加精最多只奖励一次积分。
// 场景：user 发帖 → admin 加精(+20) → admin 取消 → admin 再加精(不得分)
const BASE = process.env.YUMU_HOST || 'http://localhost:8080/api'
const rnd = () => 'rew' + Date.now().toString(36) + Math.floor(Math.random() * 10000)

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

let passed = 0, failed = 0
function assert(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label) }
  else { failed++; console.log('  ✗ ' + label) }
}

async function main() {
  console.log('═'.repeat(60))
  console.log('加精奖励只发一次 验证（反复加精不多次加分）')
  console.log('═'.repeat(60))

  const adminTok = await login('admin', 'admin123456')
  const adminAuth = { Authorization: `Bearer ${adminTok}` }

  // 注册一个一次性用户并发一帖
  const uname = rnd()
  const reg = await jfetch('/auth/register', { method: 'POST', body: JSON.stringify({ username: uname, password: 'pass123456', nickname: '奖励去重测试' }) })
  assert(reg.code === 200, `注册用户 ${uname}`)
  const uTok = await login(uname, 'pass123456')
  const uAuth = { Authorization: `Bearer ${uTok}` }
  const me = await jfetch('/auth/me', { headers: uAuth })
  const uid = me.data?.id
  assert(!!uid, '拿到用户 id')

  // 发帖（普通用户 → 待审，不影响加精奖励逻辑）
  const post = await jfetch('/posts', {
    method: 'POST', headers: uAuth,
    body: JSON.stringify({ boardId: 1, gameId: 2, title: '加精奖励只发一次-' + uname, content: 'test content' })
  })
  const pid = post.data?.id
  assert(post.code === 200 && pid, `用户发帖 id=${pid}`)

  const points = async () => {
    const s = await jfetch('/points/status', { headers: uAuth })
    return s.data?.totalPoints ?? -1
  }
  const essenceToggle = async () => {
    const r = await jfetch(`/admin/posts/${pid}/essence`, { method: 'POST', headers: adminAuth })
    return r.data?.isEssence ?? null
  }

  const p0 = await points()
  console.log(`\n起始积分 = ${p0}`)

  console.log('\n[1] 首次加精 → +20')
  let e = await essenceToggle()
  assert(e === 1, `加精后 isEssence=${e}`)
  const p1 = await points()
  assert(p1 - p0 === 20, `积分 +20（${p0} → ${p1}）`)

  console.log('\n[2] 取消加精 → 不扣分')
  e = await essenceToggle()
  assert(e === 0, `取消后 isEssence=${e}`)
  const p2 = await points()
  assert(p2 === p1, `取消加精不扣分（${p1} → ${p2}）`)

  console.log('\n[3] 再次加精 → 不再加分（核心修复点）')
  e = await essenceToggle()
  assert(e === 1, `再次加精 isEssence=${e}`)
  const p3 = await points()
  assert(p3 === p2, `二次加精积分不变（${p2} → ${p3}）`)

  console.log('\n[4] 再次取消（收尾，恢复未加精状态）')
  e = await essenceToggle()
  assert(e === 0, `收尾取消 isEssence=${e}`)

  console.log('\n' + '═'.repeat(60))
  console.log(`结果：${passed} 通过 / ${failed} 失败`)
  console.log('═'.repeat(60))
  if (failed) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
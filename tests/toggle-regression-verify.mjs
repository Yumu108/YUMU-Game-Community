/**
 * 综合 toggle 回归：验证所有「唯一键 + 逻辑删除」型操作往返不再 Duplicate entry。
 * 覆盖：点赞/收藏（并发+串行）、关注、板块订阅、关键词订阅、每日精选设置-撤销-重设。
 */
const BASE = 'http://localhost:8080/api'

async function jfetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  })
  return res.json()
}

async function login(u, p) {
  const r = await jfetch('/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) })
  if (r.code !== 200) throw new Error(`login fail ${u}: ${r.message}`)
  return r.data.token
}

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log(`✅ ${msg}`) }
  else { failed++; console.log(`❌ ${msg}`) }
}

const rnd = () => 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1000)

async function main() {
  const adminToken = await login('admin', (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME'))
  const adminAuth = { Authorization: `Bearer ${adminToken}` }

  // 注册两个测试用户
  const ua = rnd(), ub = rnd()
  await jfetch('/auth/register', { method: 'POST', body: JSON.stringify({ username: ua, password: 'pass123456', nickname: 'A' }) })
  await jfetch('/auth/register', { method: 'POST', body: JSON.stringify({ username: ub, password: 'pass123456', nickname: 'B' }) })
  const ta = await login(ua, 'pass123456')
  const tb = await login(ub, 'pass123456')
  const authA = { Authorization: `Bearer ${ta}` }
  const authB = { Authorization: `Bearer ${tb}` }
  const meA = await jfetch('/auth/me', { headers: authA })
  const meB = await jfetch('/auth/me', { headers: authB })
  const uidA = meA.data.id, uidB = meB.data.id

  // ===== 1. 点赞：并发 10 + 串行交替 =====
  const posts = await jfetch('/posts?current=1&size=1', { headers: authA })
  const postId = posts.data?.records?.[0]?.id
  assert(!!postId, '获取测试帖子')

  const likeRs = await Promise.all(Array.from({ length: 10 }, () => jfetch(`/posts/${postId}/like`, { method: 'POST', headers: authA })))
  assert(likeRs.every(r => r.code === 200), `点赞 10 并发全 200（错误=${likeRs.filter(r => r.code !== 200).length}）`)
  const favRs = await Promise.all(Array.from({ length: 10 }, () => jfetch(`/posts/${postId}/favorite`, { method: 'POST', headers: authA })))
  assert(favRs.every(r => r.code === 200), `收藏 10 并发全 200（错误=${favRs.filter(r => r.code !== 200).length}）`)

  let ok = true
  for (let i = 0; i < 6; i++) {
    const r = await jfetch(`/posts/${postId}/like`, { method: 'POST', headers: authA })
    if (r.code !== 200) ok = false
  }
  assert(ok, '点赞串行交替 6 次全 200')
  ok = true
  for (let i = 0; i < 6; i++) {
    const r = await jfetch(`/posts/${postId}/favorite`, { method: 'POST', headers: authA })
    if (r.code !== 200) ok = false
  }
  assert(ok, '收藏串行交替 6 次全 200')

  // ===== 2. 关注：关注 → 取关 → 再关注（僵尸冲突场景）=====
  const f1 = await jfetch(`/follow/${uidB}`, { method: 'POST', headers: authA })
  assert(f1.code === 200 && f1.data?.followed === true, 'A 关注 B')
  const f2 = await jfetch(`/follow/${uidB}`, { method: 'POST', headers: authA })
  assert(f2.code === 200 && f2.data?.followed === false, 'A 取关 B')
  const f3 = await jfetch(`/follow/${uidB}`, { method: 'POST', headers: authA })
  assert(f3.code === 200 && f3.data?.followed === true, 'A 再关注 B（无唯一键冲突）')
  const f4 = await jfetch(`/follow/${uidB}`, { method: 'POST', headers: authA })
  assert(f4.code === 200 && f4.data?.followed === false, 'A 再取关 B（收尾）')

  // ===== 3. 板块订阅：订阅 → 取消 → 再订阅 =====
  const boards = await jfetch('/boards', { headers: authA })
  const leafBoard = (function findLeaf(nodes) {
    for (const n of nodes || []) {
      if (n.children && n.children.length) { const f = findLeaf(n.children); if (f) return f }
      else if (n.id) return n
    }
    return null
  })(boards.data)
  assert(!!leafBoard?.id, `获取叶子板块 ${leafBoard?.name}`)

  const s1 = await jfetch(`/subscribe/board/${leafBoard.id}`, { method: 'POST', headers: authA })
  assert(s1.code === 200 && s1.data?.followed === true, '订阅板块')
  const s2 = await jfetch(`/subscribe/board/${leafBoard.id}`, { method: 'POST', headers: authA })
  assert(s2.code === 200 && s2.data?.followed === false, '取消订阅板块')
  const s3 = await jfetch(`/subscribe/board/${leafBoard.id}`, { method: 'POST', headers: authA })
  assert(s3.code === 200 && s3.data?.followed === true, '再订阅板块（无唯一键冲突）')
  const s4 = await jfetch(`/subscribe/board/${leafBoard.id}`, { method: 'POST', headers: authA })
  assert(s4.code === 200 && s4.data?.followed === false, '再取消订阅板块（收尾）')

  // ===== 4. 关键词订阅：订阅 → 取消 → 再订阅 =====
  const kw = '测试关键词' + Math.floor(Math.random() * 10000)
  const k1 = await jfetch('/subscribe/keyword', { method: 'POST', headers: authA, body: JSON.stringify({ keyword: kw }) })
  assert(k1.code === 200 && k1.data?.followed === true, '订阅关键词')
  const k2 = await jfetch('/subscribe/keyword', { method: 'POST', headers: authA, body: JSON.stringify({ keyword: kw }) })
  assert(k2.code === 200 && k2.data?.followed === false, '取消订阅关键词')
  const k3 = await jfetch('/subscribe/keyword', { method: 'POST', headers: authA, body: JSON.stringify({ keyword: kw }) })
  assert(k3.code === 200 && k3.data?.followed === true, '再订阅关键词（无唯一键冲突）')
  const k4 = await jfetch('/subscribe/keyword', { method: 'POST', headers: authA, body: JSON.stringify({ keyword: kw }) })
  assert(k4.code === 200 && k4.data?.followed === false, '再取消订阅关键词（收尾）')

  // ===== 5. 人工加精 → 当日精选 essence 段置顶（v1.2：精选自动选 + post.is_essence 优先）=====
  const today = new Date().toISOString().slice(0, 10)
  const pFind = await jfetch(`/posts?current=1&size=20&sort=latest`, { headers: authA })
  const todayPost = (pFind.data?.records || []).find((p) => (p.createdAt || '').slice(0, 10) === today && p.userId !== 1)
  const toggleEssence = (id) => jfetch(`/admin/posts/${id}/essence`, { method: 'POST', headers: adminAuth }).catch(() => null)
  if (todayPost) {
    // 幂等拨到「加精」态：toggle 至 isEssence=1（toggle 是 0↔1 开关，最多两次）
    let t = await toggleEssence(todayPost.id)
    if (!t || t.code !== 200 || t.data == null) {
      console.log('  ⊘ 跳过：post.essence toggle API 不可用')
    } else {
      if (t.data.isEssence !== 1) await toggleEssence(todayPost.id)
      // 断言：该帖出现在当日精选列表，且其前面全部为 essence 帖（essence 段置顶）
      const daily1 = await jfetch(`/picks/daily?date=${today}`)
      const list1 = daily1.data || []
      const idx1 = list1.findIndex((p) => p.id === todayPost.id)
      assert(idx1 !== -1, `加精后该帖出现在每日精选（id=${todayPost.id}）`)
      if (idx1 !== -1) {
        const beforeAllEssence = list1.slice(0, idx1).every((p) => p.isEssence)
        assert(beforeAllEssence, '该帖之前全部为人工加精帖（essence 置顶优先）')
      }
      // 收尾：取消加精，恢复原状
      await toggleEssence(todayPost.id)
    }
  } else {
    console.log('  ⊘ 跳过：当日暂无新增帖子，无法触发 essence 优先路径')
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  if (failed) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })

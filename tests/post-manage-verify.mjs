/**
 * 验证帖子删除/隐藏功能 + 统计口径：
 * 1. 作者隐藏帖子 → 帖子数 -1，获赞数不变
 * 2. 作者恢复帖子 → 帖子数 +1
 * 3. 作者删除帖子 → 帖子数 -1，获赞数减少
 * 4. 非作者操作 → 403；未登录 → 401
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
const rnd = () => 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1000)

async function main() {
  const adminToken = await login('admin', (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME'))
  const adminAuth = { Authorization: `Bearer ${adminToken}` }

  // 注册测试用户 A（作者）和 B（非作者）
  const ua = rnd(), ub = rnd()
  await jfetch('/auth/register', { method: 'POST', body: JSON.stringify({ username: ua, password: 'pass123456', nickname: 'A' }) })
  await jfetch('/auth/register', { method: 'POST', body: JSON.stringify({ username: ub, password: 'pass123456', nickname: 'B' }) })
  const ta = await login(ua, 'pass123456')
  const tb = await login(ub, 'pass123456')
  const authA = { Authorization: `Bearer ${ta}` }
  const authB = { Authorization: `Bearer ${tb}` }
  const meA = await jfetch('/auth/me', { headers: authA })
  const uidA = meA.data.id

  // A 发一篇帖子（普通用户发帖 → 待审核，先用 admin 审核通过）
  const boards = await jfetch('/boards')
  const boardId = (function leaf(ns) {
    for (const n of ns || []) {
      if (n.children && n.children.length) { const f = leaf(n.children); if (f) return f }
      else if (n.id) return n.id
    }
    return null
  })(boards.data)
  const created = await jfetch('/posts', { method: 'POST', headers: authA, body: JSON.stringify({ title: '测试帖', content: '内容', boardId }) })
  const postId = created.data.id
  assert(!!postId, `A 发帖成功 id=${postId}`)
  // admin 审核通过（普通用户帖初始 status=2）
  await jfetch(`/admin/posts/${postId}/approve`, { method: 'POST', headers: adminAuth })
  // A 给自己的帖子点个赞（自己赞自己）
  await jfetch(`/posts/${postId}/like`, { method: 'POST', headers: authA })

  // 基线：A 的帖数与获赞（/users/{id} 才返回 postCount）
  const profileOf = async (auth) => (await jfetch(`/users/${uidA}`, { headers: auth })).data
  const me1 = await profileOf(authA)
  const postCount1 = me1.postCount ?? 0
  const likeRecv1 = me1.likeReceivedCount ?? 0
  console.log(`  基线：postCount=${postCount1}, likeReceivedCount=${likeRecv1}（含刚才自己点的 1 赞）`)

  // ===== 1. 隐藏帖子 =====
  const h1 = await jfetch(`/posts/${postId}/hide`, { method: 'POST', headers: authA })
  assert(h1.code === 200 && h1.data?.status === 1, '作者隐藏帖子成功 (status=1)')
  const me2 = await profileOf(authA)
  assert(me2.postCount === postCount1 - 1, `隐藏后帖子数 -1（${postCount1}→${me2.postCount}）`)
  assert(me2.likeReceivedCount === likeRecv1, `隐藏后获赞数不变（${likeRecv1}）`)
  // 其他人看不到隐藏帖
  const othersView = await jfetch(`/posts?boardId=${boardId}&current=1&size=50`, { headers: authB })
  assert(!othersView.data.records.some(p => p.id === postId), '隐藏后公共列表不含该帖')
  // 作者自己还能看到（自己的帖子列表含隐藏）
  const selfList = await jfetch(`/users/${uidA}/posts?current=1&size=50`, { headers: authA })
  assert(selfList.data.records.some(p => p.id === postId), '作者自己的帖子列表仍能看到隐藏帖')
  // 作者能打开隐藏帖详情
  const selfDetail = await jfetch(`/posts/${postId}`, { headers: authA })
  assert(selfDetail.code === 200, '作者本人可查看自己的隐藏帖详情')
  const othersDetail = await jfetch(`/posts/${postId}`, { headers: authB })
  assert(othersDetail.code === 404, '其他人访问隐藏帖 → 404')

  // ===== 2. 恢复帖子 =====
  const r1 = await jfetch(`/posts/${postId}/restore`, { method: 'POST', headers: authA })
  assert(r1.code === 200 && r1.data?.status === 0, '作者恢复帖子成功 (status=0)')
  const me3 = await profileOf(authA)
  assert(me3.postCount === postCount1, `恢复后帖子数回到基线（${me3.postCount}）`)

  // ===== 3. 权限：非作者 403 =====
  const f1 = await jfetch(`/posts/${postId}/hide`, { method: 'POST', headers: authB })
  assert(f1.code === 403, `非作者隐藏别人的帖子 → 403（实际 code=${f1.code}）`)
  const f2 = await jfetch(`/posts/${postId}`, { method: 'DELETE', headers: authB })
  assert(f2.code === 403, `非作者删除别人��帖子 → 403`)

  // ===== 4. 删除帖子 =====
  // 此时帖子仍有隐藏阶段留下的 1 个赞（自己点的），删除后获赞应 -1
  const me4 = await profileOf(authA)
  const postCountBeforeDel = me4.postCount
  const likeRecvBeforeDel = me4.likeReceivedCount
  const d1 = await jfetch(`/posts/${postId}`, { method: 'DELETE', headers: authA })
  assert(d1.code === 200 && d1.data?.deleted === true, '作者删除帖子成功')
  const me5 = await profileOf(authA)
  assert(me5.postCount === postCountBeforeDel - 1, `删除后帖子数 -1（${postCountBeforeDel}→${me5.postCount}）`)
  assert(me5.likeReceivedCount === likeRecvBeforeDel - 1, `删除后获赞数 -1（${likeRecvBeforeDel}→${me5.likeReceivedCount}，自己点的 1 赞不再计入）`)
  // 删除后详情 404（对任何人）
  const afterDel = await jfetch(`/posts/${postId}`, { headers: adminAuth })
  assert(afterDel.code === 404, '删除后详情 → 404')
  const afterDelList = await jfetch(`/users/${uidA}/posts?current=1&size=50`, { headers: authA })
  assert(!afterDelList.data.records.some(p => p.id === postId), '删除后作者自己的帖子列表也不含该帖')

  // ===== 5. ADMIN 可操作别人的帖子 =====
  const created2 = await jfetch('/posts', { method: 'POST', headers: authA, body: JSON.stringify({ title: '测试帖2', content: '内容', boardId }) })
  const postId2 = created2.data.id
  await jfetch(`/admin/posts/${postId2}/approve`, { method: 'POST', headers: adminAuth })
  const dAdmin = await jfetch(`/posts/${postId2}`, { method: 'DELETE', headers: adminAuth })
  assert(dAdmin.code === 200, 'ADMIN 可删除他人帖子')

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  if (failed) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })

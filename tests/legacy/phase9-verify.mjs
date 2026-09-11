// Phase 9 修复验证
// 覆盖：用户主页 TA 的帖子只显示本人 / 公告管理刷新正常（参数转换）/ 跑马灯公告 API
// 用法：node phase9-verify.mjs
const BASE = 'http://localhost:8080/api'

let pass = 0, fail = 0
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg) }
  else { fail++; console.log('  ✗ FAIL:', msg) }
}
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const j = await r.json().catch(() => ({}))
  return { http: r.status, code: j.code, data: j.data, msg: j.message, raw: j }
}
const jget = (p, t) => j('GET', p, null, t)
const jpost = (p, b, t) => j('POST', p, b, t)
const jput = (p, b, t) => j('PUT', p, b, t)
const jdel = (p, t) => j('DELETE', p, null, t)

const suffix = Date.now().toString(36).slice(-6)
let A = '', U1 = '', U2 = ''
let u1 = {}, u2 = {}

async function main() {
  console.log('═══ Phase 9 修复验证 ═══\n')

  // ---------- 0. 准备账号 ----------
  console.log('[0] 准备账号')
  const login = await jpost('/auth/login', { username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') })
  assert(login.code === 200 && login.data?.token, `admin 登录成功`)
  A = login.data?.token
  const r1 = await jpost('/auth/register', { username: 'p9u1_' + suffix, password: 'pass123456', nickname: 'P9U1' })
  const r2 = await jpost('/auth/register', { username: 'p9u2_' + suffix, password: 'pass123456', nickname: 'P9U2' })
  assert(r1.code === 200, `注册 u1`)
  assert(r2.code === 200, `注册 u2`)
  U1 = r1.data?.token; u1 = r1.data?.user
  U2 = r2.data?.token; u2 = r2.data?.user

  // ---------- 1. #3 公告管理刷新参数 ----------
  console.log('\n[1] 公告管理刷新 / 分页')
  // 修复前：current 传字符串/对象会触发 Spring 转换异常
  const refresh = await jget('/admin/announcements?current=1&size=10', A)
  assert(refresh.code === 200 && Array.isArray(refresh.data?.records), `current=1 (long 类型) → 200`)
  const page2 = await jget('/admin/announcements?current=2&size=5', A)
  assert(page2.code === 200, `current=2 size=5 → 200`)
  // 边界：超大 size 应被 clamp 到 100（后端已有 MAX_PAGE_SIZE=100）
  const big = await jget('/admin/announcements?current=1&size=99999', A)
  assert(big.code === 200, `超大 size 被 clamp 仍 200`)

  // ---------- 2. #1 用户主页 TA 的帖子 ----------
  console.log('\n[2] 用户主页 TA 的帖子只显示本人')
  // 取一个子板块
  const tree = await jget('/boards')
  const firstChild = tree.data?.flatMap((p) => p.children || []).find((c) => c.id) || tree.data?.[0]
  const boardId = firstChild?.id

  // u1 发 2 个帖，u2 发 1 个帖
  const p1a = await jpost('/posts', { title: 'P9 u1 帖 A', content: '<p>u1-A</p>', boardId }, U1)
  const p1b = await jpost('/posts', { title: 'P9 u1 帖 B', content: '<p>u1-B</p>', boardId }, U1)
  const p2 = await jpost('/posts', { title: 'P9 u2 帖', content: '<p>u2</p>', boardId }, U2)
  assert(p1a.code === 200 && p1b.code === 200 && p2.code === 200, `各用户发帖成功`)
  // 审核流：普通用户帖默认待审，先由 admin 审核通过，主页才会展示
  for (const pid of [p1a.data?.id, p1b.data?.id, p2.data?.id]) {
    if (typeof pid === 'number') await jpost(`/admin/posts/${pid}/approve`, null, A)
  }

  // u1 主页（GET /users/{u1.id}）只应返回 u1 的帖子，不含 u2 的
  const profileU1 = await jget(`/users/${u1.id}`, U2) // 用 u2 当 viewer
  assert(profileU1.code === 200, `u1 用户主页 200`)
  const u1Posts = profileU1.data?.posts || []
  const u1Ids = u1Posts.map((p) => p.userId)
  assert(u1Ids.length >= 2, `u1 主页帖子数 ≥2 (实际 ${u1Ids.length})`)
  assert(u1Ids.every((id) => id === u1.id), `u1 主页所有帖子都是 u1 自己 (userIds=${[...new Set(u1Ids)].join(',')})`)
  assert(!u1Ids.includes(u2.id), `u1 主页不包含 u2 的帖`)

  // u2 主页只返回 u2 的
  const profileU2 = await jget(`/users/${u2.id}`, U1)
  const u2Posts = profileU2.data?.posts || []
  const u2Ids = u2Posts.map((p) => p.userId)
  assert(u2Ids.length >= 1, `u2 主页帖子数 ≥1`)
  assert(u2Ids.every((id) => id === u2.id), `u2 主页所有帖子都是 u2 自己 (userIds=${[...new Set(u2Ids)].join(',')})`)
  assert(!u2Ids.includes(u1.id), `u2 主页不包含 u1 的帖`)

  // admin 主页：包含 admin 自己 + u1 + u2 的帖（因为之前有 phase8 测试帖）— 重点验证 admin 自己的帖子在
  const profileAdmin = await jget(`/users/1`, U1)
  assert(profileAdmin.code === 200, `admin 用户主页 200`)
  const adminIds = (profileAdmin.data?.posts || []).map((p) => p.userId)
  assert(adminIds.every((id) => id === 1), `admin 主页所有帖子都是 admin 自己的 (userIds=${[...new Set(adminIds)].join(',')})`)

  // 清理
  await jpost('/admin/posts/' + p1a.data.id + '/hide', {}, A)
  await jpost('/admin/posts/' + p1b.data.id + '/hide', {}, A)
  await jpost('/admin/posts/' + p2.data.id + '/hide', {}, A)

  // ---------- 3. #4 公告弹窗 API ----------
  console.log('\n[3] 公告跑马灯 API')
  // 创建 3 条公告
  const c1 = await jpost('/admin/announcements', { title: 'P9-A ' + suffix, content: 'Phase9 第一条', sort: 10 }, A)
  const c2 = await jpost('/admin/announcements', { title: 'P9-B ' + suffix, content: 'Phase9 第二条', sort: 8 }, A)
  const c3 = await jpost('/admin/announcements', { title: 'P9-C ' + suffix, content: 'Phase9 第三条', sort: 6 }, A)
  assert(c1.code === 200 && c2.code === 200 && c3.code === 200, `创建 3 条公告`)
  const pubList = await jget('/announcements?size=10')
  const ids = (pubList.data || []).map((a) => a.id)
  assert(ids.includes(c1.data?.id) && ids.includes(c2.data?.id) && ids.includes(c3.data?.id), `公开接口能查到 3 条`)

  // 详情
  const detail = await jget(`/announcements/${c2.data?.id}`)
  assert(detail.code === 200 && detail.data?.title?.includes('P9-B'), `公告详情能取到 title/content`)

  // 删除清理
  await jdel(`/admin/announcements/${c1.data?.id}`, A)
  await jdel(`/admin/announcements/${c2.data?.id}`, A)
  await jdel(`/admin/announcements/${c3.data?.id}`, A)

  console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 ════════`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('脚本异常:', e); process.exit(2) })
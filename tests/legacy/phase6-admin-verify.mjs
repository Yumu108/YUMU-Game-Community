// Phase 6 管理/审核后台 验证脚本
// 用法:
//   node phase6-admin-verify.mjs setup   -> 注册管理员/普通用户，选一个帖子，写入 phase6-admin-state.json
//   node phase6-admin-verify.mjs test     -> 读状态，跑断言（需先 setup 并由外部 SQL 把管理员提升为 ADMIN 角色）
import { writeFileSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const BASE = 'http://localhost:8080/api'
const STATE = 'phase6-admin-state.json'

let pass = 0, fail = 0
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg) }
  else { fail++; console.log('  ✗ FAIL:', msg) }
}
async function jpost(path, body, token) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body)
  })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, code: j.code, data: j.data, raw: j }
}
async function jget(path, token) {
  const r = await fetch(BASE + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, code: j.code, data: j.data, raw: j }
}

async function setup() {
  const suffix = randomUUID().slice(0, 8)
  const adminName = 'admin_' + suffix
  const userName = 'user_' + suffix
  const a = await jpost('/auth/register', { username: adminName, password: 'admin123', nickname: '管理员' })
  const u = await jpost('/auth/register', { username: userName, password: 'user123', nickname: '普通用户' })
  if (a.code !== 200 || !a.data?.token) { console.error('admin register failed', a); process.exit(1) }
  if (u.code !== 200 || !u.data?.token) { console.error('user register failed', u); process.exit(1) }
  const adminToken = a.data.token
  const userToken = u.data.token
  const adminId = a.data.user.id
  // 取一个可见帖子作为目标
  const posts = await jget('/posts?size=1')
  const postId = posts.data?.records?.[0]?.id
  if (!postId) { console.error('no post available'); process.exit(1) }
  const state = { adminName, userName, adminId, adminToken, userToken, postId }
  writeFileSync(STATE, JSON.stringify(state, null, 2))
  console.log('setup done ->', state)
}

async function test() {
  let s
  try { s = JSON.parse(readFileSync(STATE, 'utf8')) }
  catch { console.error('请先运行 setup 模式'); process.exit(1) }
  const { adminToken: A, userToken: U, postId: P } = s

  console.log('\n[1] 角色越权校验：普通用户访问 /admin 应 403（HTTP 200 + code=403，与全局约定一致）')
  const r1 = await jpost(`/admin/posts/${P}/pin`, {}, U)
  assert(r1.code === 403, `普通用户 pin 返回 code=403 (实际 status=${r1.status}, code=${r1.code})`)
  const r1b = await jget('/admin/reports', U)
  assert(r1b.code === 403, `普通用户列举报返回 code=403 (实际 status=${r1b.status}, code=${r1b.code})`)
  const r1c = await jget('/admin/reports') // 未登录
  assert(r1c.status === 401 && r1c.code === 401, `未登录列举报返回 401 (实际 status=${r1c.status}, code=${r1c.code})`)

  console.log('\n[2] 管理员置顶/加精')
  const pin1 = await jpost(`/admin/posts/${P}/pin`, {}, A)
  assert(pin1.code === 200 && pin1.data?.isTop === 1, `pin -> isTop=1 (实际 ${JSON.stringify(pin1.data)})`)
  const pin0 = await jpost(`/admin/posts/${P}/pin`, {}, A)
  assert(pin0.code === 200 && pin0.data?.isTop === 0, `再次 pin -> isTop=0(取消)`)
  const ess1 = await jpost(`/admin/posts/${P}/essence`, {}, A)
  assert(ess1.code === 200 && ess1.data?.isEssence === 1, `essence -> isEssence=1`)
  const ess0 = await jpost(`/admin/posts/${P}/essence`, {}, A)
  assert(ess0.code === 200 && ess0.data?.isEssence === 0, `再次 essence -> isEssence=0`)

  console.log('\n[3] 隐藏/恢复帖子')
  const hide = await jpost(`/admin/posts/${P}/hide`, {}, A)
  assert(hide.code === 200 && hide.data?.status === 1, `hide -> status=1`)
  const afterHide = await jget(`/posts/${P}`, A)
  assert(afterHide.code === 404, `隐藏后详情不可见 (code=${afterHide.code})`)
  const restore = await jpost(`/admin/posts/${P}/restore`, {}, A)
  assert(restore.code === 200 && restore.data?.status === 0, `restore -> status=0`)
  const afterRestore = await jget(`/posts/${P}`, A)
  assert(afterRestore.code === 200, `恢复后详情可见 (code=${afterRestore.code})`)

  console.log('\n[4] 普通用户提交举报')
  const rep = await jpost('/reports', { targetType: 1, targetId: P, reason: '测试举报-广告内容' }, U)
  assert(rep.code === 200 && rep.data?.id, `提交举报成功 (id=${rep.data?.id})`)
  const reportId = rep.data.id

  console.log('\n[5] 管理员列出待处理举报')
  const list0 = await jget('/admin/reports?status=0', A)
  assert(list0.code === 200, `举报列表返回 200`)
  const found = list0.data?.records?.some((x) => x.id === reportId)
  assert(found, `待处理列表中包含刚提交的举报 #${reportId}`)

  console.log('\n[6] 管理员处理举报(标记违规) -> 帖子被隐藏')
  const handle = await jpost(`/admin/reports/${reportId}/handle`, { status: 1, handleNote: '确认违规，已处理' }, A)
  assert(handle.code === 200, `处理举报返回 200`)
  const afterHandle = await jget(`/posts/${P}`, A)
  assert(afterHandle.code === 404, `标记违规后帖子被自动隐藏 (code=${afterHandle.code})`)
  const list1 = await jget('/admin/reports?status=1', A)
  const handled = list1.data?.records?.some((x) => x.id === reportId && x.status === 1)
  assert(handled, `已处理列表包含该举报且 status=1`)

  console.log('\n[7] 管理员 me 含 ADMIN 角色')
  const me = await jget('/auth/me', A)
  assert(Array.isArray(me.data?.roles) && me.data.roles.includes('ADMIN'), `me.roles 含 ADMIN (${JSON.stringify(me.data?.roles)})`)

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  process.exit(fail === 0 ? 0 : 1)
}

const mode = process.argv[2] || 'test'
if (mode === 'setup') await setup()
else await test()

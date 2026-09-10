/**
 * 验证审核"查看内容"权限修复：
 * 1. 版主能查看自己负责板块的待审帖
 * 2. 版主不能查看自己没负责板块的待审帖
 * 3. ADMIN 全权可查看任何帖子
 * 4. 普通用户无权限（403）
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

async function main() {
  // 拿一个 pending 帖作为测试对象
  const adminToken = await login('admin', 'admin123456')
  const adminAuth = { Authorization: `Bearer ${adminToken}` }
  const pending = await jfetch('/admin/posts?status=2&current=1&size=10', { headers: adminAuth })
  const list = pending.data?.records || []
  assert(list.length > 0, `找到待审核帖共 ${list.length} 条`)
  if (list.length === 0) { console.log('无待审核帖可验证'); return }

  // ADMIN 全权
  const a1 = await jfetch(`/admin/posts/${list[0].id}/detail`, { headers: adminAuth })
  assert(a1.code === 200 && a1.data?.title, `ADMIN 可查看待审帖 #${list[0].id}：${a1.data?.title}`)

  // yumu（子版主，负责 PC 游戏 board_id=11）
  const yumuToken = await login('yumu', '123456')
  const yumuAuth = { Authorization: `Bearer ${yumuToken}` }
  // 找一个 board_id=11 的待审帖给 yumu 看（应该有，因为 PC 游戏 经常有新帖）
  const pcPending = await jfetch('/admin/posts?status=2&boardId=11&current=1&size=10', { headers: adminAuth })
  const pcList = pcPending.data?.records || []
  if (pcList.length > 0) {
    const y1 = await jfetch(`/admin/posts/${pcList[0].id}/detail`, { headers: yumuAuth })
    assert(y1.code === 200 && y1.data?.title, `子版主 yumu 可查看自己板块待审帖 #${pcList[0].id}：${y1.data?.title}`)
  } else {
    console.log('⚠️ PC 游戏板块暂无待审帖，跳过 yumu 正面用例')
  }
  // yumu 不能查看非负责板块的待审帖
  const otherBoardId = 1 // 攻略心得
  const otherPending = await jfetch(`/admin/posts?status=2&boardId=${otherBoardId}&current=1&size=10`, { headers: adminAuth })
  const oList = otherPending.data?.records || []
  if (oList.length > 0) {
    const y2 = await jfetch(`/admin/posts/${oList[0].id}/detail`, { headers: yumuAuth })
    assert(y2.code === 403, `子版主 yumu 不能查看非负责板块待审帖 → 403（实际 code=${y2.code}）`)
  } else {
    console.log('⚠️ 其他板块暂无待审帖，跳过 yumu 反面用例')
  }

  // 普通用户（注册新用户）
  const rnd = 'a' + Date.now().toString(36)
  await jfetch('/auth/register', { method: 'POST', body: JSON.stringify({ username: rnd, password: 'pass123456', nickname: 'A' }) })
  const userToken = await login(rnd, 'pass123456')
  const userAuth = { Authorization: `Bearer ${userToken}` }
  const u1 = await jfetch(`/admin/posts/${list[0].id}/detail`, { headers: userAuth })
  assert(u1.code === 403, `普通用户 ${rnd} 无查看审核详情权限 → 403`)

  // 验证个人主页 /auth/me 携带 moderatorBoardNames
  const me = await jfetch('/auth/me', { headers: yumuAuth })
  assert(me.code === 200 && Array.isArray(me.data?.moderatorBoardNames), `/auth/me 含 moderatorBoardNames 数组`)
  assert(me.data?.moderatorBoardNames?.includes('PC 游戏'), `yumu /auth/me moderatorBoardNames 含「PC 游戏」`)
  assert(me.data?.badge === 'SUB_MODERATOR' || me.data?.badge === 'MODERATOR', `yumu /auth/me badge=${me.data?.badge}`)

  // 验证个人主页 /users/{id} 同样字段
  const profile = await jfetch('/users/2', { headers: adminAuth })
  assert(profile.data?.moderatorBoardNames?.includes('PC 游戏'), `/users/2 moderatorBoardNames 含「PC 游戏」`)
  assert(profile.data?.badge === 'SUB_MODERATOR' || profile.data?.badge === 'MODERATOR', `/users/2 badge=${profile.data?.badge}`)

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  if (failed) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
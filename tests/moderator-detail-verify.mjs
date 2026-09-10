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

  // yumu（版主）—— 负责的游戏从**实际授权**动态取。
  // 🚨 9-05 起授权以游戏为粒度（board_id 恒 NULL），写死 boardId=11 / 「PC 游戏」会因种子数据变化而失效，
  //    更要命的是「查不到待审帖就 console.log 跳过」会把正向用例静默跳过 → 覆盖盲区。
  //    这里改为：查不到就自造一张待审帖，保证正向用例一定执行；用完删掉。
  const yumuToken = await login('yumu', '123456')
  const yumuAuth = { Authorization: `Bearer ${yumuToken}` }
  const yumuBoards = await jfetch('/admin/users/2/moderator-boards', { headers: adminAuth })
  const yumuGameId = (yumuBoards.data || [])[0]?.gameId
  assert(!!yumuGameId, `yumu 有版主授权（负责 gameId=${yumuGameId}）`)

  let createdPostId = null
  const ownPending = await jfetch(`/admin/posts?status=2&gameId=${yumuGameId}&current=1&size=10`, { headers: adminAuth })
  let ownPost = (ownPending.data?.records || [])[0]
  if (!ownPost) {
    const author = 'md' + Date.now().toString(36)
    await jfetch('/auth/register', { method: 'POST', body: JSON.stringify({ username: author, password: 'pass123456', nickname: 'MD' }) })
    const authorToken = await login(author, 'pass123456')
    const created = await jfetch('/posts', {
      method: 'POST',
      body: JSON.stringify({ boardId: 1, gameId: yumuGameId, title: 'md-pending-' + author, content: 'test' }),
      headers: { Authorization: `Bearer ${authorToken}` }
    })
    createdPostId = created.data?.id
    ownPost = { id: createdPostId }
    console.log(`  （本游戏暂无待审帖，已自造 #${createdPostId} 供正向用例）`)
  }
  const y1 = await jfetch(`/admin/posts/${ownPost.id}/detail`, { headers: yumuAuth })
  assert(y1.code === 200 && y1.data?.title, `版主 yumu 可查看本游戏待审帖 #${ownPost.id}：${y1.data?.title}`)

  // 反面用例：yumu 不能查看**非负责游戏**的待审帖
  const otherGameId = (list.find((p) => p.gameId && p.gameId !== yumuGameId) || {}).gameId
  if (otherGameId) {
    const otherPending = await jfetch(`/admin/posts?status=2&gameId=${otherGameId}&current=1&size=10`, { headers: adminAuth })
    const oList = otherPending.data?.records || []
    assert(oList.length > 0, `找到非负责游戏(gameId=${otherGameId})的待审帖 ${oList.length} 条`)
    if (oList.length > 0) {
      const y2 = await jfetch(`/admin/posts/${oList[0].id}/detail`, { headers: yumuAuth })
      assert(y2.code === 403, `版主 yumu 不能查看非负责游戏的待审帖 → 403（实际 code=${y2.code}）`)
    }
  } else {
    console.log('⚠️ 待审队列中没有「其他游戏」的帖，跳过反面用例')
  }

  // 清理自造帖
  if (createdPostId) {
    await jfetch(`/posts/${createdPostId}`, { method: 'DELETE', headers: adminAuth })
    console.log(`  已清理自造待审帖 #${createdPostId}`)
  }

  // 普通用户（注册新用户）
  const rnd = 'a' + Date.now().toString(36)
  await jfetch('/auth/register', { method: 'POST', body: JSON.stringify({ username: rnd, password: 'pass123456', nickname: 'A' }) })
  const userToken = await login(rnd, 'pass123456')
  const userAuth = { Authorization: `Bearer ${userToken}` }
  const u1 = await jfetch(`/admin/posts/${list[0].id}/detail`, { headers: userAuth })
  assert(u1.code === 403, `普通用户 ${rnd} 无查看审核详情权限 → 403`)

  // 验证 /auth/me 携带版主负责信息
  // 🚨 9-05 起「取消板块细分」：授权以**游戏**为粒度（board_id 置 NULL）→ moderatorBoardNames 恒为空数组，
  //    现行字段是 moderatorGameNames（前端徽章 badge.js / My.vue / UserProfile.vue 都用它）。
  //    期望值从实际授权动态取，别把版主负责的游戏写死（种子数据会变）。
  const expectedGames = (yumuBoards.data || []).map((x) => x.gameName).filter(Boolean)
  assert(expectedGames.length > 0, `yumu 有版主授权（实际 ${JSON.stringify(expectedGames)}）`)

  const me = await jfetch('/auth/me', { headers: yumuAuth })
  assert(me.code === 200 && Array.isArray(me.data?.moderatorGameNames), `/auth/me 含 moderatorGameNames 数组`)
  assert(expectedGames.every((g) => me.data?.moderatorGameNames?.includes(g)),
    `yumu /auth/me moderatorGameNames 含实际负责游戏 ${JSON.stringify(expectedGames)}（实际 ${JSON.stringify(me.data?.moderatorGameNames)}）`)
  assert(me.data?.badge === 'SUB_MODERATOR' || me.data?.badge === 'MODERATOR', `yumu /auth/me badge=${me.data?.badge}`)

  // 验证个人主页 /users/{id} 同样字段
  const profile = await jfetch('/users/2', { headers: adminAuth })
  assert(expectedGames.every((g) => (profile.data?.moderatorGameNames || []).includes(g)),
    `/users/2 moderatorGameNames 含实际负责游戏 ${JSON.stringify(expectedGames)}（实际 ${JSON.stringify(profile.data?.moderatorGameNames)}）`)
  assert(profile.data?.badge === 'SUB_MODERATOR' || profile.data?.badge === 'MODERATOR', `/users/2 badge=${profile.data?.badge}`)

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  if (failed) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
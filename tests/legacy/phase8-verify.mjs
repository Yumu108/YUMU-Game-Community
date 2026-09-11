// Phase 8 全量增强 端到端验证
// 覆盖：Badge 身份徽章（ADMIN/MODERATOR/SUB_MODERATOR）/ 公告 CRUD / 活跃度累加
// 用法：node phase8-verify.mjs
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
let newPostId = null, replyId = null
let newBoardId = null

async function main() {
  console.log('═══ Phase 8 后台增强验证 ═══\n')

  // ---------- 0. 准备账号 ----------
  console.log('[0] 准备账号')
  const login = await jpost('/auth/login', { username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') })
  assert(login.code === 200 && login.data?.token, `admin 登录成功`)
  A = login.data?.token
  const r1 = await jpost('/auth/register', { username: 'p8u1_' + suffix, password: 'pass123456', nickname: 'Phase8U1' })
  const r2 = await jpost('/auth/register', { username: 'p8u2_' + suffix, password: 'pass123456', nickname: 'Phase8U2' })
  assert(r1.code === 200 && r1.data?.token, `注册 u1 成功`)
  assert(r2.code === 200 && r2.data?.token, `注册 u2 成功`)
  U1 = r1.data?.token; u1 = r1.data?.user
  U2 = r2.data?.token; u2 = r2.data?.user

  // ---------- 1. 公告 CRUD（公开 + 管理） ----------
  console.log('\n[1] 公告 CRUD')
  // 公开接口：未登录
  const pub0 = await jget('/announcements')
  assert(pub0.code === 200, `公开 GET /announcements 200`)
  // 创建公告（ADMIN）
  const create = await jpost('/admin/announcements', {
    title: 'Phase8 公告 ' + suffix, content: '本条用于验证公告 CRUD', sort: 99, status: 0
  }, A)
  assert(create.code === 200 && create.data?.id, `创建公告 (id=${create.data?.id})`)
  const anId = create.data?.id
  // 公开接口应能查到
  const pub1 = await jget('/announcements?size=10')
  assert((pub1.data || []).some((a) => a.id === anId), `公开接口能查到新公告`)
  // 更新（改为隐藏）
  const upd = await jput(`/admin/announcements/${anId}`, {
    title: 'Phase8 公告 已隐藏', content: '本条已隐藏', sort: 99, status: 1
  }, A)
  assert(upd.code === 200, `更新公告`)
  const pub2 = await jget('/announcements?size=10')
  assert(!(pub2.data || []).some((a) => a.id === anId), `公开接口不包含隐藏公告`)
  // 恢复展示
  await jput(`/admin/announcements/${anId}`, {
    title: 'Phase8 公告 ' + suffix, content: '本条用于验证公告 CRUD', sort: 99, status: 0
  }, A)
  // 普通用户 CRUD 应 403
  const forbidden = await jpost('/admin/announcements', { title: 'x', content: 'y' }, U1)
  assert(forbidden.code === 403, `普通用户创建公告 403`)
  // 管理端分页
  const list = await jget(`/admin/announcements?current=1&size=5`, A)
  assert(list.code === 200 && Array.isArray(list.data?.records), `管理端分页列表`)
  // 删除
  const del = await jdel(`/admin/announcements/${anId}`, A)
  assert(del.code === 200, `删除公告`)
  const pub3 = await jget('/announcements?size=20')
  assert(!(pub3.data || []).some((a) => a.id === anId), `删除后公开接口不可见`)

  // ---------- 2. 活跃度累加（发帖 +10 / 回帖 +5 / 点赞 +2 / 登录 +3） ----------
  console.log('\n[2] 活跃度累加事件触发')
  // 登录 +3：u1 重新登录（之前是注册时未加分）
  const loginU1 = await jpost('/auth/login', { username: u1.username, password: 'pass123456' })
  U1 = loginU1.data?.token
  const me1a = await jget('/auth/me', U1)
  const score1a = me1a.data?.activityScore || 0
  // 应得 3 分
  assert(score1a === 3, `u1 登录后 activityScore=3 (实际 ${score1a})`)
  assert(me1a.data?.activityLevel === 1, `u1 等级仍 1（<100）`)
  assert(me1a.data?.activityTitle === '🥉初出茅庐', `u1 称号「${me1a.data?.activityTitle}」`)

  // 发帖：选第一个子板块
  const tree = await jget('/boards')
  const firstChild = tree.data?.flatMap((p) => p.children || []).find((c) => c.id) || tree.data?.[0]
  const boardId = firstChild?.id
  // 同日再登录一次，不加分
  const loginAgain = await jpost('/auth/login', { username: u1.username, password: 'pass123456' })
  U1 = loginAgain.data?.token
  const me1b = await jget('/auth/me', U1)
  assert((me1b.data?.activityScore || 0) === 3, `同日二次登录不加分 (score=${me1b.data?.activityScore})`)

  const np = await jpost('/posts', {
    title: 'Phase8 验证帖 ' + suffix, content: '<p>活跃度测试</p>', boardId
  }, U1)
  assert(np.code === 200 && np.data?.id, `u1 发帖成功 (id=${np.data?.id})`)
  newPostId = np.data?.id
  // 审核流：普通用户帖默认待审，先由 admin 审核通过，后续才能回帖/被公开点赞
  const appr = await jpost(`/admin/posts/${newPostId}/approve`, null, A)
  assert(appr.code === 200, `admin 审核通过 u1 的帖`)
  const me1c = await jget('/auth/me', U1)
  assert((me1c.data?.activityScore || 0) === 13, `发帖 +10 → activityScore=13 (实际 ${me1c.data?.activityScore})`)

  // 回帖 +5
  const rp = await jpost(`/posts/${newPostId}/replies`, { postId: newPostId, content: 'Phase8 回帖' }, U1)
  assert(rp.code === 200 && rp.data?.id, `u1 回帖成功`)
  replyId = rp.data?.id
  const me1d = await jget('/auth/me', U1)
  assert((me1d.data?.activityScore || 0) === 18, `回帖 +5 → activityScore=18 (实际 ${me1d.data?.activityScore})`)

  // 被点赞 +2（u2 给 u1 的帖点赞）
  const like = await jpost(`/posts/${newPostId}/like`, {}, U2)
  assert(like.code === 200, `u2 点赞 u1 的帖`)
  const me1e = await jget('/auth/me', U1)
  assert((me1e.data?.activityScore || 0) === 20, `被点赞 +2 → activityScore=20 (实际 ${me1e.data?.activityScore})`)

  // 攒到 100 分升 2 级：注册两个 u + 给 u2 也分别操作
  // 简化：直接 SQL 模拟 +82 分不现实（无后端 patch）；改为登录 + 注册刷分
  // 这里只验证：score 累加正确、level/title 在 100 以下仍是 1
  assert(me1e.data?.activityLevel === 1, `当前分 20 → 仍 level 1`)
  assert(me1e.data?.activityTitle === '🥉初出茅庐', `称号仍「初出茅庐」`)

  // ---------- 3. Badge 身份徽章 ----------
  console.log('\n[3] Badge 身份徽章')
  // admin: ADMIN 红色
  const meA = await jget('/auth/me', A)
  assert(meA.data?.badge === 'ADMIN', `admin badge=ADMIN`)
  assert(meA.data?.badgeColor === 'danger', `admin badgeColor=danger`)
  assert(meA.data?.badgeText === '管理员', `admin badgeText=「${meA.data?.badgeText}」`)

  // u1 普通用户：badge=null
  const meU1 = await jget('/auth/me', U1)
  assert(meU1.data?.badge == null, `普通用户 badge=null (实际 ${meU1.data?.badge})`)

  // u1 → 改为 MODERATOR（不分配板块）— 应为 MODERATOR（异常兜底）
  await jput(`/admin/users/${u1.id}/roles`, { roles: ['MODERATOR'] }, A)
  const meU1mod = await jget('/auth/me', U1)
  assert(meU1mod.data?.badge === 'MODERATOR', `MODERATOR 无板块 → badge=MODERATOR (异常兜底) (实际 ${meU1mod.data?.badge})`)
  assert(meU1mod.data?.badgeText === '版主', `badgeText=版主 (实际 ${meU1mod.data?.badgeText})`)

  // 创建子板块，把 u1 分配为该板块版主 → SUB_MODERATOR
  const cb = await jpost('/admin/boards', { name: 'P8 验证子' + suffix, icon: '🎮', parentId: boardId, sort: 1 }, A)
  assert(cb.code === 200 && cb.data?.id, `创建子板块`)
  newBoardId = cb.data?.id
  await jput(`/admin/users/${u1.id}/moderator-boards`, { boardIds: [newBoardId] }, A)
  const meU1sub = await jget('/auth/me', U1)
  assert(meU1sub.data?.badge === 'SUB_MODERATOR', `1 个子板块 ��� badge=SUB_MODERATOR (实际 ${meU1sub.data?.badge})`)
  assert(meU1sub.data?.badgeText === '子板主', `badgeText=子板主 (实际 ${meU1sub.data?.badgeText})`)

  // 再分配另一个子板块（>=2 个）→ MODERATOR（总版主）
  const cb2 = await jpost('/admin/boards', { name: 'P8 验证子2 ' + suffix, icon: '🎯', parentId: boardId, sort: 2 }, A)
  await jput(`/admin/users/${u1.id}/moderator-boards`, { boardIds: [newBoardId, cb2.data?.id] }, A)
  const meU1multi = await jget('/auth/me', U1)
  assert(meU1multi.data?.badge === 'MODERATOR', `>=2 个子板块 → badge=MODERATOR (实际 ${meU1multi.data?.badge})`)
  assert(meU1multi.data?.badgeText === '版主', `badgeText=版主 (实际 ${meU1multi.data?.badgeText})`)

  // ---------- 4. 帖子/回帖返回 authorBadge / authorLevel ----------
  console.log('\n[4] PostVO/ReplyVO 携带 badge/level')
  // admin 发帖
  const ap = await jpost('/posts', { title: 'P8 admin 帖', content: '<p>管理员发帖测试</p>', boardId }, A)
  assert(ap.code === 200, `admin 发帖`)
  const detailA = await jget(`/posts/${ap.data?.id}`, U1)
  assert(detailA.data?.authorBadge === 'ADMIN', `admin 帖子 authorBadge=ADMIN`)
  assert(typeof detailA.data?.authorLevelTitle === 'string' && detailA.data?.authorLevelTitle.length > 0, `admin 帖子 authorLevelTitle 存在 (实际 ${detailA.data?.authorLevelTitle})`)

  // 改回 u1 USER 角色，恢复原状
  await jput(`/admin/users/${u1.id}/roles`, { roles: ['USER'] }, A)
  await jdel(`/admin/boards/${newBoardId}`, A)
  await jdel(`/admin/boards/${cb2.data?.id}`, A)

  console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 ════════`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('脚本异常:', e); process.exit(2) })
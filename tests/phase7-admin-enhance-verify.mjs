// Phase 7 后台管理系统增强 端到端验证
// 覆盖：板块管理(CRUD/启停) / 用户深度管理(封禁/资料/改密/删除+自保护) / 帖子审核发布(approve/pending/预览) / 回帖审核(隐藏/恢复) / 举报回复联动隐藏
// 用法：node phase7-admin-enhance-verify.mjs
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
let newBoardParentId = null, newBoardChildId = null
let newPostId = null, replyId = null

async function main() {
  console.log('═══ Phase 7 后台管理增强验证 ═══\n')

  // ---------- 0. 登录 admin + 注册普通用户 ----------
  console.log('[0] 准备账号')
  const login = await jpost('/auth/login', { username: 'admin', password: 'admin123456' })
  assert(login.code === 200 && login.data?.token, `admin 登录成功 (code=${login.code})`)
  A = login.data?.token
  const r1 = await jpost('/auth/register', { username: 'pv7u1_' + suffix, password: 'pass123456', nickname: '验证明星' })
  const r2 = await jpost('/auth/register', { username: 'pv7u2_' + suffix, password: 'pass123456', nickname: '待删用户' })
  assert(r1.code === 200 && r1.data?.token, `注册 u1 成功`)
  assert(r2.code === 200 && r2.data?.token, `注册 u2 成功`)
  U1 = r1.data?.token; u1 = r1.data?.user
  U2 = r2.data?.token; u2 = r2.data?.user

  // ---------- 1. 板块管理 ----------
  console.log('\n[1] 板块管理（ADMIN）')
  const b403 = await jget('/admin/boards', U1)
  assert(b403.code === 403, `普通用户列板块 403 (code=${b403.code})`)
  const b401 = await jget('/admin/boards')
  assert(b401.code === 401 || b401.http === 401, `未登录列板块 401`)
  const blist = await jget('/admin/boards', A)
  assert(blist.code === 200 && Array.isArray(blist.data), `ADMIN 列板块成功 (${blist.data?.length} 个)`)
  const cb = await jpost('/admin/boards', { name: '验证分类' + suffix, icon: '🧪', description: 'phase7 自动验证', sort: 99 }, A)
  assert(cb.code === 200 && cb.data?.id, `创建一级板块 (id=${cb.data?.id})`)
  newBoardParentId = cb.data?.id
  const cs = await jpost('/admin/boards', { name: '验证子板块' + suffix, icon: '🎯', parentId: newBoardParentId, sort: 1 }, A)
  assert(cs.code === 200 && cs.data?.id, `创建子板块 (id=${cs.data?.id})`)
  newBoardChildId = cs.data?.id
  const up = await jput(`/admin/boards/${newBoardChildId}`, { name: '验证子板块改' + suffix, icon: '🎯', parentId: newBoardParentId, sort: 2 }, A)
  assert(up.code === 200, `更新子板块名称`)
  const tg = await jpost(`/admin/boards/${newBoardParentId}/toggle-status`, {}, A)
  assert(tg.code === 200 && tg.data?.status === 1, `禁用分类 -> status=1`)
  const tgBack = await jpost(`/admin/boards/${newBoardParentId}/toggle-status`, {}, A)
  assert(tgBack.code === 200 && tgBack.data?.status === 0, `重新启用分类 -> status=0`)
  // 删除：先子后父
  const delChild = await jdel(`/admin/boards/${newBoardChildId}`, A)
  assert(delChild.code === 200, `删除空子板块成功`)
  const delParent = await jdel(`/admin/boards/${newBoardParentId}`, A)
  assert(delParent.code === 200, `删除空分类成功`)
  // 有帖子板块禁止删除：找现有带帖子的板块（公开树为数组，含 children）
  const realBoards = await jget('/boards')
  const boardTree = realBoards.data || []
  const realWithPosts = boardTree.flatMap((p) => {
    const subs = (p.children || []).filter((c) => (c.postCount || 0) > 0).map((c) => ({ id: c.id, n: c.postCount }))
    return subs.length ? subs : ((p.postCount || 0) > 0 ? [{ id: p.id, n: p.postCount }] : [])
  })[0]
  if (realWithPosts) {
    const delDeny = await jdel(`/admin/boards/${realWithPosts.id}`, A)
    assert(delDeny.code === 400, `删除有 ${realWithPosts.n} 帖的板块被拒 (code=${delDeny.code})`)
  } else {
    console.log('  - (无带帖子板块可测删除拦截，跳过)')
  }

  // ---------- 2. 用户深度管理 ----------
  console.log('\n[2] 用户深度管理（封禁/解封/资料/改密/删除）')
  const ban = await j('PUT', `/admin/users/${u1.id}/status?status=1`, null, A)
  assert(ban.code === 200, `封禁 u1`)
  const bannedToken = await jget('/auth/me', U1)
  assert(bannedToken.code === 401 || bannedToken.http === 401, `封禁后旧 token 失效 (code=${bannedToken.code})`)
  const bannedLogin = await jpost('/auth/login', { username: u1.username, password: 'pass123456' })
  assert(bannedLogin.code === 403, `封禁后登录被拒「${bannedLogin.msg}」 (code=${bannedLogin.code})`)
  const unban = await j('PUT', `/admin/users/${u1.id}/status?status=0`, null, A)
  assert(unban.code === 200, `解封 u1`)
  const reLogin = await jpost('/auth/login', { username: u1.username, password: 'pass123456' })
  assert(reLogin.code === 200 && reLogin.data?.token, `解封后可重新登录`)
  U1 = reLogin.data?.token

  const prof = await jput(`/admin/users/${u1.id}/profile`, { nickname: '改名小明', bio: '来自后台的简介', email: 'pv7' + suffix + '@test.com', gender: 1 }, A)
  assert(prof.code === 200, `后台编辑资料`)
  const detail = await jget(`/admin/users/${u1.id}`, A)
  assert(detail.code === 200 && detail.data?.nickname === '改名小明' && detail.data?.gender === 1, `资料已生效 (nickname=${detail.data?.nickname})`)

  const rp1 = await jput(`/admin/users/${u1.id}/reset-password`, { newPassword: 'NewPass888' }, A)
  assert(rp1.code === 200 && rp1.data?.password === 'NewPass888', `重置密码(指定)`)
  const loginNew = await jpost('/auth/login', { username: u1.username, password: 'NewPass888' })
  assert(loginNew.code === 200, `新密码可登录`)
  const rp2 = await jput(`/admin/users/${u1.id}/reset-password`, { newPassword: '' }, A)
  assert(rp2.code === 200 && rp2.data?.password && rp2.data.password.length >= 8, `重置密码(随机生成 ${rp2.data?.password})`)
  const loginRand = await jpost('/auth/login', { username: u1.username, password: rp2.data?.password })
  assert(loginRand.code === 200, `随机密码可登录`)

  const me = await jget('/auth/me', A)
  const adminId = me.data?.id
  const selfBanReal = await j('PUT', `/admin/users/${adminId}/status?status=1`, null, A)
  assert(selfBanReal.code === 400, `不能封禁自己 (code=${selfBanReal.code})`)
  const selfDel = await jdel(`/admin/users/${adminId}`, A)
  assert(selfDel.code === 400, `不能删除自己 (code=${selfDel.code})`)

  const delU2 = await jdel(`/admin/users/${u2.id}`, A)
  assert(delU2.code === 200, `删除 u2`)
  const u2Login = await jpost('/auth/login', { username: u2.username, password: 'pass123456' })
  assert(u2Login.code !== 200, `删除后 u2 无法登录 (code=${u2Login.code})`)

  // ---------- 3. 帖子审核发布 ----------
  console.log('\n[3] 帖子审核发布（pending/approve/预览）')
  const boardsPub = await jget('/boards')
  const tree = boardsPub.data || []
  const firstChild = tree.flatMap((p) => p.children || []).find((c) => c.id) || tree[0]
  const boardId = firstChild?.id
  assert(!!boardId, `找到可用板块 (boardId=${boardId})`)
  const np = await jpost('/posts', { title: 'Phase7 待审核帖 ' + suffix, content: '<p>审核发布验证内容</p>', boardId }, U1)
  assert(np.code === 200 && np.data?.id, `u1 发帖成功 (id=${np.data?.id})`)
  newPostId = np.data?.id
  const pend = await jpost(`/admin/posts/${newPostId}/pending`, {}, A)
  assert(pend.code === 200 && pend.data?.status === 2, `设为待审核 -> status=2`)
  const pubHide = await jget(`/posts/${newPostId}`)
  assert(pubHide.code === 404 || pubHide.code === 403 || pubHide.http !== 200, `待审核帖公开不可见 (code=${pubHide.code})`)
  const prev = await jget(`/admin/posts/${newPostId}/detail`, A)
  assert(prev.code === 200 && prev.data?.id === newPostId, `管理员预览待审核帖成功`)
  const prev403 = await jget(`/admin/posts/${newPostId}/detail`, U1)
  assert(prev403.code === 403, `普通用户预览被拒 (code=${prev403.code})`)
  const appr = await jpost(`/admin/posts/${newPostId}/approve`, {}, A)
  assert(appr.code === 200 && appr.data?.status === 0, `通过发布 -> status=0`)
  const pubShow = await jget(`/posts/${newPostId}`)
  assert(pubShow.code === 200, `发布后公开可见`)
  const appr403 = await jpost(`/admin/posts/${newPostId}/approve`, {}, U1)
  assert(appr403.code === 403, `普通用户 approve 被拒 (code=${appr403.code})`)

  // ---------- 4. 回帖审核 ----------
  console.log('\n[4] 回帖审核（隐藏/恢复）')
  const rp = await jpost(`/posts/${newPostId}/replies`, { postId: newPostId, content: 'Phase7 回帖验证内容' }, U1)
  assert(rp.code === 200 && rp.data?.id, `u1 回复成功 (id=${rp.data?.id})`)
  replyId = rp.data?.id
  const hideRp = await jpost(`/admin/replies/${replyId}/hide`, {}, A)
  assert(hideRp.code === 200 && hideRp.data?.status === 1, `隐藏回帖 -> status=1`)
  const pubReplies = await jget(`/posts/${newPostId}/replies`)
  assert(!(pubReplies.data || []).some((x) => x.id === replyId), `公开回帖列表不含隐藏回帖`)
  const adminReplies = await jget(`/admin/posts/${newPostId}/replies`, A)
  assert((adminReplies.data || []).some((x) => x.id === replyId && x.status === 1), `管理端回帖列表含隐藏回帖`)
  const restRp = await jpost(`/admin/replies/${replyId}/restore`, {}, A)
  assert(restRp.code === 200 && restRp.data?.status === 0, `恢复回帖 -> status=0`)
  const pubReplies2 = await jget(`/posts/${newPostId}/replies`)
  assert((pubReplies2.data || []).some((x) => x.id === replyId), `公开回帖列表恢复可见`)

  // ---------- 5. 举报回复联动隐藏 ----------
  console.log('\n[5] 举报联动（标记回复违规 -> 自动隐藏）')
  const rep = await jpost('/reports', { targetType: 2, targetId: replyId, reason: 'phase7 验证举报' }, U1)
  assert(rep.code === 200 && rep.data?.id, `提交回复举报`)
  const reports = await jget('/admin/reports?status=0&size=5', A)
  const myReport = (reports.data?.records || []).find((x) => x.targetType === 2 && x.targetId === replyId)
  assert(!!myReport, `举报出现在管理端队列`)
  const handle = await jpost(`/admin/reports/${myReport.id}/handle`, { status: 1, handleNote: 'phase7 验证处理' }, A)
  assert(handle.code === 200, `处理为违规`)
  const afterViol = await jget(`/posts/${newPostId}/replies`)
  assert(!(afterViol.data || []).some((x) => x.id === replyId), `违规处理后面回帖自动隐藏`)
  const restAgain = await jpost(`/admin/replies/${replyId}/restore`, {}, A)
  assert(restAgain.code === 200, `管理员可恢复被举报隐藏的回帖`)

  // 清理：删除验证帖（避免污染）
  const delPost = await jpost(`/admin/posts/${newPostId}/hide`, {}, A)
  assert(delPost.code === 200, `清理验证帖（隐藏）`)

  console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 ════════`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('脚本异常:', e); process.exit(2) })

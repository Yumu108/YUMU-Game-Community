// 举报队列 + 用户管理筛选（9-07）端到端验证：
//   ① 举报回复 type=2 含 postId / replyId / replyFloor / targetTitle（用于「查看回复」跳转与预览）
//   ② 举报帖子 type=1 含 postId（用于「查看帖子」跳转）
//   ③ 用户管理 gameId 过滤：仅返回担任该游戏版主的用户
//   ④ 用户管理不带 gameId：返回全部用户（关键字 + 角色过滤仍工作）
// 运行：cd tests && node admin-filters-verify.mjs   （需后端 :8080 在跑）
const BASE = 'http://localhost:8080/api'
const j = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined
  })
  const data = await r.json().catch((e) => { console.error('[j parse fail]', e); return null })
  return { status: r.status, code: data?.code, data: data?.data, raw: data }
}
const jget = (p, t) => j('GET', p, null, t)
const jpost = (p, b, t) => j('POST', p, b, t)
const jput = (p, b, t) => j('PUT', p, b, t)
const jdel = (p, t) => j('DELETE', p, null, t)

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra) }
}

async function loginOrRegister(username, password, nickname = '') {
  let r = await jpost('/auth/login', { username, password })
  if (r.code === 200 && r.data?.token) return { token: r.data.token, id: r.data.user?.id }
  r = await jpost('/auth/register', { username, password, nickname: nickname || username })
  if (r.code === 200 && r.data?.token) return { token: r.data.token, id: r.data.user?.id }
  throw new Error('login/register failed: ' + JSON.stringify(r.raw))
}

async function main() {
  const stamp = Date.now().toString().slice(-10)
  const admin = await loginOrRegister('admin', 'admin123456')
  const adminToken = admin.token

  // 准备：建测试帖 → A 发回帖 → B 举报该回帖
  const boardId = ((await jget('/boards')).data || [])[0]?.id ?? 1
  const p = await jpost('/posts', {
    boardId, title: '举报筛选测试帖 ' + stamp,
    content: '举报筛选测试正文', summary: '���报筛选测试摘要', cover: ''
  }, adminToken)
  const postId = p.data?.id
  check('测试帖创建成功（id=' + postId + '）', !!postId)

  const uA = 'rfa_' + stamp
  const uB = 'rfb_' + stamp
  const regA = await loginOrRegister(uA, 'user123')
  const regB = await loginOrRegister(uB, 'user123')
  const tokA = regA.token
  const tokB = regB.token
  check('用户 A/B 就绪', !!tokA && !!tokB)

  const ra = await jpost(`/posts/${postId}/replies`, { content: 'A 的回帖 ' + stamp }, tokA)
  const replyId = ra.data?.id
  check('A 回帖成功（id=' + replyId + '）', ra.code === 200 && !!replyId)

  // B 举报该回帖
  const repReply = await jpost('/reports', { targetType: 2, targetId: replyId, reason: '举报筛选测试理由 ' + stamp }, tokB)
  check('举报回帖成功（id=' + repReply.data?.id + '）', repReply.code === 200 && !!repReply.data?.id)

  // C 举报该帖子
  const repPost = await jpost('/reports', { targetType: 1, targetId: postId, reason: '举报帖子测试 ' + stamp }, tokB)
  check('举报帖子成功（id=' + repPost.data?.id + '）', repPost.code === 200 && !!repPost.data?.id)

  console.log('[1] 举报队列返回补全字段（type=2 含 postId/replyId/targetTitle）')
  const repPage = await jget('/admin/reports?status=0&current=1&size=50', adminToken)
  const records = repPage.data?.records || []
  const replyReport = records.find((r) => r.targetType === 2 && r.targetId === replyId)
  const postReport = records.find((r) => r.targetType === 1 && r.targetId === postId)
  check('回复举报含 postId=' + postId, replyReport && replyReport.postId === postId,
    'got=' + replyReport?.postId)
  check('回复举报含 replyId=' + replyId, replyReport && replyReport.replyId === replyId,
    'got=' + replyReport?.replyId)
  check('回复举报含 replyFloor', replyReport && Number.isInteger(replyReport.replyFloor) && replyReport.replyFloor > 0,
    'got=' + replyReport?.replyFloor)
  check('回复举报 targetTitle 含「💬 回复」摘要', replyReport && /回复\s*#\d+/.test(replyReport.targetTitle || ''),
    'title=' + replyReport?.targetTitle)
  check('帖子举报含 postId=' + postId, postReport && postReport.postId === postId,
    'got=' + postReport?.postId)
  check('帖子举报 targetTitle=帖子标题', postReport && postReport.targetTitle && postReport.targetTitle.includes('举报筛选测试帖'),
    'title=' + postReport?.targetTitle)

  console.log('[2] 用户管理按 gameId 过滤版主（新建版主分配原神）')
  // 找一个热门游戏 id：listAdminGames 第一项（排除其他游戏 id=1）
  const gamesList = (await jget('/admin/games', adminToken)).data || []
  // 选 id>1 的第一个游戏（id=1「其他游戏」不带热门）
  const targetGame = (gamesList.find((g) => g.id && g.id !== 1 && g.status !== 1)) || gamesList[0]
  if (!targetGame) {
    console.log('  ! 找不到游戏，跳过游戏筛版主验证')
  } else {
    // 把 regA 设为版主 + 分配 targetGame
    await jput(`/admin/users/${regA.id}/roles`, { roles: ['MODERATOR'] }, adminToken)
    await jput(`/admin/users/${regA.id}/moderator-boards`, { items: [{ gameId: targetGame.id }] }, adminToken)

    // 按 gameId 过滤查询
    const filtered = await jget(`/admin/users?gameId=${targetGame.id}&current=1&size=50`, adminToken)
    const list = filtered.data?.records || []
    const containsA = list.some((u) => u.id === regA.id)
    const containsB = list.some((u) => u.id === regB.id) // B 没分配版主应不在结果中
    check('gameId=' + targetGame.id + ' 过滤结果含 A（已分配）', containsA, 'total=' + list.length)
    check('gameId 过滤结果不含 B（未分配）', !containsB, 'list=' + list.map((u) => u.id).join(','))
    const aRecord = list.find((u) => u.id === regA.id)
    check('A 记录含 moderatorAssignments 且含 gameName=' + targetGame.name,
      aRecord && (aRecord.moderatorAssignments || []).some((m) => m.gameId === targetGame.id && m.gameName),
      'assignments=' + JSON.stringify(aRecord?.moderatorAssignments))

    // 不带 gameId 时不过滤（应含 A）
    const unfiltered = await jget(`/admin/users?current=1&size=200`, adminToken)
    const unfList = unfiltered.data?.records || []
    check('不带 gameId 时返回全部用户（含 A）', unfList.some((u) => u.id === regA.id),
      'total=' + unfList.length)
  }

  // 清理：A 改回 USER 角色（自动清空版主）
  await jput(`/admin/users/${regA.id}/roles`, { roles: ['USER'] }, adminToken)
  await jdel(`/posts/${postId}`, adminToken)
  await jdel(`/admin/users/${regA.id}`, adminToken)
  await jdel(`/admin/users/${regB.id}`, adminToken)
  console.log('已清理测试数据')

  console.log(`\n═══ 举报+用户筛选验证：通过 ${pass} / 失败 ${fail} ═══`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('ERR', e); process.exit(1) })
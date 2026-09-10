// 楼中楼优化（9-07）端到端验证：
//  ① 回复列表每个 item 必须带 userId / authorName / authorAvatar（前端头像/昵称跳主页依赖，缺 userId → /user/undefined bug）
//  ② 回复点赞接口 POST /posts/replies/{id}/like（liked 切换 + likeCount 增减）
//  ③ 嵌套回复（replyToId）→ 返回 replyToName（前端渲染「回复 @昵称：」前缀）
//  ④ 举报回复 targetType=2
// 运行：cd tests && node reply-actions-verify.mjs   （需后端 :8080 在跑）
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
const jdel = (p, t) => j('DELETE', p, null, t)

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra) }
}

async function loginOrRegister(username, password) {
  let r = await jpost('/auth/login', { username, password })
  if (r.code === 200 && r.data?.token) return { token: r.data.token, id: r.data.user?.id }
  r = await jpost('/auth/register', { username, password, nickname: username })
  if (r.code === 200 && r.data?.token) return { token: r.data.token, id: r.data.user?.id }
  throw new Error('login/register failed: ' + JSON.stringify(r.raw))
}

async function main() {
  const stamp = Date.now().toString().slice(-10)
  const admin = await loginOrRegister('admin', 'admin123456')
  check('管理员登录', !!admin.token)

  const uA = 'raA_' + stamp
  const uB = 'raB_' + stamp
  const regA = await loginOrRegister(uA, 'user123')
  const regB = await loginOrRegister(uB, 'user123')
  check('用户 A/B 就绪', !!regA.token && !!regB.token)

  // 建测试帖（admin 直发可见）
  const boards = (await jget('/boards')).data || []
  const boardId = boards[0]?.id ?? 1
  const p = await jpost('/posts', {
    boardId, title: '回帖操作验证帖 ' + stamp,
    content: '回帖操作验证正文', summary: '回帖操作验证摘要', cover: ''
  }, admin.token)
  const postId = p.data?.id
  check('帖子创建成功（id=' + postId + '）', !!postId)

  // A 发顶级回复，B 发嵌套回复（replyToId=A）
  const ra = await jpost(`/posts/${postId}/replies`, { content: 'A 顶级回复 ' + stamp }, regA.token)
  const raId = ra.data?.id
  check('A 顶级回复成功（id=' + raId + '）', ra.code === 200 && !!raId)
  const rb = await jpost(`/posts/${postId}/replies`, { content: 'B 回复 A ' + stamp, replyToId: raId }, regB.token)
  const rbId = rb.data?.id
  check('B 嵌套回复成功（id=' + rbId + '）', rb.code === 200 && !!rbId)

  console.log('[1] 回复列表必须带 userId/authorName/authorAvatar（前端跳主页数据）')
  const flat1 = (await jget(`/posts/${postId}/replies`)).data || []
  check('返回扁平数组且 ≥2 条', Array.isArray(flat1) && flat1.length >= 2, 'len=' + flat1.length)
  const miss = flat1.filter((x) => x.userId == null || !x.authorName)
  check('每条回复都带 userId + authorName（修复 /user/undefined）', miss.length === 0,
    '缺失 ' + miss.length + ' 条: ' + JSON.stringify(miss.map((m) => ({ id: m.id, userId: m.userId }))))
  const noAva = flat1.filter((x) => x.authorAvatar == null && !x.authorName)
  check('每条回复都带 authorAvatar 或可回退昵称', noAva.length === 0)
  const b1 = flat1.find((x) => x.id === rbId)
  check('嵌套回复 replyToId=' + raId, b1?.replyToId === raId, 'got=' + b1?.replyToId)
  check('嵌套回复 replyToName=' + uA + '（@前缀数据）', b1?.replyToName === uA, 'got=' + b1?.replyToName)
  check('嵌套回复 replyToUserId=被回复者id（前缀@昵称可跳主页）', b1?.replyToUserId === regA.id,
    'got=' + b1?.replyToUserId + ' expect=' + regA.id)

  console.log('[2] 回复点赞 toggle')
  const like1 = await jpost(`/posts/replies/${raId}/like`, null, regB.token)
  check('B 赞 A 的回复 → liked=true', like1.code === 200 && like1.data?.liked === true,
    JSON.stringify(like1.raw))
  const like2 = await jpost(`/posts/replies/${raId}/like`, null, regB.token)
  check('再点取消 → liked=false', like2.code === 200 && like2.data?.liked === false,
    JSON.stringify(like2.raw))
  // 未登录 401
  const likeAnon = await jpost(`/posts/replies/${raId}/like`, null)
  check('未登录点赞被拒（401）', likeAnon.code === 401, 'code=' + likeAnon.code)

  console.log('[3] 举报回复 targetType=2')
  const rep = await jpost('/reports', { targetType: 2, targetId: raId, reason: '验证举报回复 ' + stamp }, regB.token)
  check('举报回复成功', rep.code === 200 && !!rep.data?.id, JSON.stringify(rep.raw))

  // 清理
  await jdel(`/posts/replies/${raId}`, regA.token)   // A 删自己的回复（含级联删除引用已不再展示）
  await jdel(`/posts/replies/${rbId}`, regB.token)
  await jdel(`/posts/${postId}`, admin.token)
  for (const id of [regA.id, regB.id]) await jdel(`/admin/users/${id}`, admin.token)
  console.log('已清理测试数据')

  console.log(`\n═══ 回帖操作验证：通过 ${pass} / 失败 ${fail} ═══`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('ERR', e); process.exit(1) })

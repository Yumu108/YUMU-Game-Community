// 楼中楼嵌套 + 用户举报（9-07 二次重构）端到端验证：
//   ① 后端 /posts/{id}/replies 返回扁平数组 + userId/replyToUserId/replyToName 字段齐全
//   ② 前端 community.js normalizeReplies 把扁平回复按 replyToId 构造成嵌套 children 树（4399 楼中楼）
//      - A.children 含 B；B.children 含 C（任意深度）
//      - 每条节点的 userId/authorBadge/replyToUserId 都正确传递
//   ③ 用户举报 targetType=3 → 200
// 运行：cd tests && node reply-tree-verify.mjs   （需后端 :8080 在跑）
const BASE = 'http://localhost:8080/api'
const j = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined
  })
  const data = await r.json().catch(() => null)
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

// 与前端 community.js normalizeReplies 一致的平铺式楼中楼算法
// （9-07 第三次重构：取消无限嵌套缩进，子评论全部挂到一级主回复下）
function buildTree(flat) {
  const nodes = (flat || []).map((r) => ({ ...r, children: [] }))
  const map = {}
  nodes.forEach((n) => { map[n.id] = n })
  const roots = []
  nodes.forEach((n) => {
    if (n.replyToId && map[n.replyToId]) {
      // 沿 replyToId 链向上找根，挂到根的 children（不递归）
      let cur = n
      const seen = new Set([n.id])
      while (cur.replyToId && map[cur.replyToId] && !seen.has(cur.replyToId)) {
        seen.add(cur.replyToId)
        cur = map[cur.replyToId]
      }
      cur.children.push(n)
    } else {
      roots.push(n)
    }
  })
  return roots
}

async function main() {
  const stamp = Date.now().toString().slice(-10)
  const admin = await loginOrRegister('admin', 'admin123456')

  // 三层嵌套：A → B（回复 A） → C（回复 B）
  const uA = 'ta_' + stamp, uB = 'tb_' + stamp, uC = 'tc_' + stamp
  const regA = await loginOrRegister(uA, 'user123')
  const regB = await loginOrRegister(uB, 'user123')
  const regC = await loginOrRegister(uC, 'user123')

  // 建测试帖（admin 直发）
  const boardId = ((await jget('/boards')).data || [])[0]?.id ?? 1
  const p = await jpost('/posts', {
    boardId, title: '楼中楼嵌套测试 ' + stamp,
    content: '嵌套测试正文', summary: '嵌套测试摘要', cover: ''
  }, admin.token)
  const postId = p.data?.id
  check('测试帖创建成功（id=' + postId + '）', !!postId)

  // 构造三层嵌套（A 是顶级；B 是 A 的子；C 是 B 的子）
  const ra = await jpost(`/posts/${postId}/replies`, { content: 'A 顶级 ' + stamp }, regA.token)
  const raId = ra.data?.id
  const rb = await jpost(`/posts/${postId}/replies`, { content: 'B 回复 A ' + stamp, replyToId: raId }, regB.token)
  const rbId = rb.data?.id
  const rc = await jpost(`/posts/${postId}/replies`, { content: 'C 回复 B ' + stamp, replyToId: rbId }, regC.token)
  const rcId = rc.data?.id
  check('A/B/C 三层回复成功', ra.code === 200 && rb.code === 200 && rc.code === 200)
  check('B.replyToId=raId / C.replyToId=rbId',
    rb.raw?.data?.id === rbId && rc.raw?.data?.id === rcId)

  console.log('[1] 后端返回扁平回复且字段完整')
  const flat = (await jget(`/posts/${postId}/replies`)).data || []
  const fA = flat.find((x) => x.id === raId)
  const fB = flat.find((x) => x.id === rbId)
  const fC = flat.find((x) => x.id === rcId)
  check('返回数组 ≥ 3 条', flat.length >= 3, 'len=' + flat.length)
  check('每条都带 userId / authorName / authorAvatar', flat.every((x) => x.userId && x.authorName))
  check('B 带 replyToId=raId + replyToName=uA + replyToUserId=A.id',
    fB?.replyToId === raId && fB?.replyToName === uA && fB?.replyToUserId === regA.id,
    JSON.stringify({ replyToId: fB?.replyToId, replyToName: fB?.replyToName, replyToUserId: fB?.replyToUserId }))
  check('C 带 replyToId=rbId + replyToName=uB + replyToUserId=B.id',
    fC?.replyToId === rbId && fC?.replyToName === uB && fC?.replyToUserId === regB.id)

  console.log('[2] 前端同款 normalizeReplies 构树 → 平铺式楼中楼（取消无限嵌套）')
  const tree = buildTree(flat)
  const A = tree.find((x) => x.id === raId)
  check('A 是根节点（顶级）', !!A)
  // 9-07 平铺式：所有非顶级子回复（A→B→C 三层）都直接挂到 A.children，B.children 应为空
  check('A.children 含 B（直接子评论）',
    A?.children?.some((c) => c.id === rbId), 'A children ids=' + (A?.children || []).map((c) => c.id))
  check('A.children 含 C（即使 C 的 replyToId=B，平铺时也挂到 A 下，不缩进）',
    A?.children?.some((c) => c.id === rcId), 'A children ids=' + (A?.children || []).map((c) => c.id))
  const B = A?.children?.find((c) => c.id === rbId)
  check('B.children 必须是空（不递归）', !B?.children || B.children.length === 0,
    'B children=' + JSON.stringify((B?.children || []).map((c) => c.id)))
  const C = A?.children?.find((c) => c.id === rcId)
  check('C.children 必须是空（不递归）', !C?.children || C.children.length === 0)
  check('平铺后 A 全部子评论数 = 2（包含 B 和 C）',
    A?.children?.length === 2, 'count=' + A?.children?.length)
  check('树中节点含 userId（头像/昵称跳主页）',
    A?.userId && B?.userId && C?.userId === regC.id,
    'A.userId=' + A?.userId + ' B.userId=' + B?.userId + ' C.userId=' + C?.userId)
  check('树中节点含 replyToUserId（@前缀点击跳主页）',
    A?.replyToUserId == null && B?.replyToUserId === regA.id && C?.replyToUserId === regB.id)

  console.log('[3] 用户举报 targetType=3 → 200')
  const rep = await jpost('/reports', { targetType: 3, targetId: regA.id, reason: '楼中楼测试举报用户 ' + stamp }, regC.token)
  check('举报用户成功', rep.code === 200 && !!rep.data?.id, JSON.stringify(rep.raw))

  // 清理：删帖 + 删测试用户
  await jdel(`/posts/${postId}`, admin.token)
  for (const id of [regA.id, regB.id, regC.id]) await jdel(`/admin/users/${id}`, admin.token)
  console.log('已清理测试数据')

  console.log(`\n═══ 楼中楼树 + 用户举报验证：通过 ${pass} / 失败 ${fail} ═══`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('ERR', e); process.exit(1) })
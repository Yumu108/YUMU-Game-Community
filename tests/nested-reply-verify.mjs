// 楼中楼嵌套回复验证：
//   后端返回「扁平列表 + replyToId」，前端 normalizeReplies 拼树；
//   本脚本模拟前端拼树逻辑后断言：B(replyToId=A) → A.children 含 B。
// 运行：cd tests && node nested-reply-verify.mjs   （需后端 :8080 在跑）
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

// 与前端 community.js normalizeReplies 一致的扁平→树
function buildTree(flat) {
  const map = {}
  for (const r of flat) map[r.id] = { ...r, children: [] }
  const roots = []
  for (const r of flat) {
    if (r.replyToId && map[r.replyToId]) map[r.replyToId].children.push(map[r.id])
    else roots.push(map[r.id])
  }
  return roots
}

async function main() {
  const stamp = Date.now().toString().slice(-10) // 同一脚本多次跑保留唯一
  const admin = await loginOrRegister('admin', 'admin123456')
  const adminToken = admin.token
  check('管理员登录', !!adminToken)

  const uA = 'nrA_' + stamp
  const uB = 'nrB_' + stamp
  const regA = await loginOrRegister(uA, 'user123')
  const regB = await loginOrRegister(uB, 'user123')
  const tokA = regA.token
  const tokB = regB.token
  const idA = regA.id, idB = regB.id
  check('用户A/B 注册成功', !!tokA && !!tokB)

  // 准备帖子：admin 直接发可见帖
  const board = (await jget('/boards')).parents?.[0]
  const boardId = board?.id ?? 1
  const adminPost = await jpost('/posts', {
    boardId,
    title: '楼中楼测试帖 ' + stamp,
    content: '楼中楼测试正文',
    summary: '楼中楼测试摘要',
    cover: ''
  }, adminToken)
  const postId = adminPost.data?.id
  check('admin 帖子创建成功（id=' + postId + '）', !!postId)

  // A 发顶级回复
  const ra = await jpost(`/posts/${postId}/replies`, { content: 'A 的顶级回复 ' + stamp }, tokA)
  const raId = ra.data?.id
  check('A 顶级回复成功（id=' + raId + '）', ra.code === 200 && !!raId)

  // B 回复 A（楼中楼，关键：必须带 replyToId=raId）
  const rb = await jpost(`/posts/${postId}/replies`, {
    content: 'B 回复 A 的嵌套回复 ' + stamp,
    replyToId: raId
  }, tokB)
  const rbId = rb.data?.id
  check('B 嵌套回复（带 replyToId）成功（id=' + rbId + '）', rb.code === 200 && !!rbId)

  console.log('[1] 拉取回复 → 扁平列表含 replyToId/replyToName')
  const resp = await jget(`/posts/${postId}/replies`)
  const flat = resp.data || []
  check('接口返回扁平数组', Array.isArray(flat) && flat.length >= 2,
    'len=' + flat.length)
  const aItem = flat.find((x) => x.id === raId)
  const bItem = flat.find((x) => x.id === rbId)
  check('B 项带 replyToId=raId', bItem && bItem.replyToId === raId,
    'replyToId=' + bItem?.replyToId)
  check('B 项带 replyToName=A 昵称', bItem && bItem.replyToName === uA,
    'replyToName=' + bItem?.replyToName)
  check('A 项 replyToId 为空（顶级）', aItem && aItem.replyToId == null)

  console.log('[2] 前端同款拼树 → B 挂在 A.children 下')
  const roots = buildTree(flat)
  const aRoot = roots.find((x) => x.id === raId)
  check('A 是根节点', !!aRoot)
  check('A 有 children', Array.isArray(aRoot?.children) && aRoot.children.length > 0,
    'children=' + JSON.stringify((aRoot?.children || []).map((c) => c.id)))
  const bChild = (aRoot?.children || []).find((x) => x.id === rbId)
  check('B 在 A 的 children（楼中楼生效）', !!bChild)
  check('B.replyToName === A 昵称（前端可拼「回复@xxx」前缀）', bChild?.replyToName === uA)

  console.log('[3] 反例：不带 replyToId → 顶层根节点')
  const rc2 = await jpost(`/posts/${postId}/replies`, { content: 'C 的顶级回复 ' + stamp }, tokB)
  const rc2Id = rc2.data?.id
  check('C 顶级回复成功（id=' + rc2Id + '）', rc2.code === 200 && !!rc2Id)
  const flat2 = (await jget(`/posts/${postId}/replies`)).data || []
  const cItem = flat2.find((x) => x.id === rc2Id)
  check('C.replyToId 为空', cItem && cItem.replyToId == null)
  const roots2 = buildTree(flat2)
  check('C 是根节点（不嵌套）', roots2.some((x) => x.id === rc2Id))

  // 清理：删测试用户
  for (const id of [idA, idB]) await jdel(`/admin/users/${id}`, adminToken)
  console.log('已清理测试用户')

  console.log(`\n═══ 楼中楼嵌套验证：通过 ${pass} / 失败 ${fail} ═══`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('ERR', e); process.exit(1) })
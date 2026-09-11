// 楼中楼嵌套回复验证：A 给帖子发顶级回复 → B 回复 A → 应得到 tree[0].children[0]
// 运行：cd tests && node nested-reply-verify.mjs   （需后端 :8080 在跑）
const BASE = 'http://localhost:8080/api'
const j = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined
  })
  const data = await r.json().catch(() => null)
  return { status: r.status, code: data?.code, raw: data }
}
const jget = (p, t) => j('GET', p, null, t)
const jpost = (p, b, t) => j('POST', p, b, t)

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra) }
}

async function loginOrRegister(username, password) { console.log("LR for "+username);
  let r = await jpost('/auth/login', { username, password })
  if (r.code === 200 && r.data?.token) return { token: r.data.token, id: r.data.user?.id }
  r = await jpost('/auth/register', { username, password, nickname: username })
  if (r.code === 200 && r.data?.token) return { token: r.data.token, id: r.data.user?.id }
  throw new Error("login/register failed for "+username+" : "+JSON.stringify(r.raw));
}

async function main() {
  const stamp = Date.now().toString().slice(-10) // 同一脚本多次跑保留唯一
  const admin = await loginOrRegister('admin', (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME'))
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

  // 关键验证：拉回复树，B 应作为 A 的 children
  const tree = await jget(`/posts/${postId}/replies`, null)
  const list = tree.data || []
  check('getReplies 返回树', Array.isArray(list))
  const aNode = list.find((x) => x.id === raId)
  check('A 节点存在', !!aNode)
  check('A 节点有 children 数组', Array.isArray(aNode?.children))
  const bNode = (aNode?.children || []).find((x) => x.id === rbId)
  check('B 在 A 的 children 中（楼中楼生效）', !!bNode,
    `tree[0].children=${JSON.stringify((aNode?.children || []).map((c) => ({ id: c.id, replyToId: c.replyToId })))}`)
  check('B 的 replyToId === A 的 id', bNode && bNode.replyToId === raId)
  check('B 的 replyToName === A 的昵称', bNode && bNode.replyToName === uA,
    `replyToName=${bNode?.replyToName}`)

  // 反例：不带 replyToId 应该落到顶级而非嵌套
  const rc2 = await jpost(`/posts/${postId}/replies`, { content: 'C 的顶级回复 ' + stamp }, tokB)
  const rc2Id = rc2.data?.id
  check('C 顶级回复成功（id=' + rc2Id + '）', rc2.code === 200 && !!rc2Id)
  const list2 = (await jget(`/posts/${postId}/replies`, null)).data || []
  const cNode = list2.find((x) => x.id === rc2Id)
  check('C 没有 replyToId → 不嵌套在 A 下', cNode && cNode.replyToId == null)
  check('C 仍是顶级（顶层回复）', cNode && cNode.replyToId == null)

  console.log(`\n═══ 楼中楼嵌套验证：通过 ${pass} / 失败 ${fail} ═══`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('ERR', e); process.exit(1) })
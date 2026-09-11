// 编辑帖子 + 删除自己的回帖 验证
// 用法：node tests/edit-delete-verify.mjs  （需后端运行于 http://localhost:8080/api）
//
// 覆盖场景：
//   ① 作者编辑 → 200，字段更新；详情接口读到新字段
//   ② 非作者编辑别人帖 → 403
//   ③ ADMIN 编辑任意帖 → 200
//   ④ 编辑不能改 status/isTop/isEssence（DTO 不暴露这些字段，绕审被堵）
//   ⑤ 作者删除自己的回帖 → 200，软删 + 不出现在公开列表
//   ⑥ 非作者删除别人回帖 → 403
//   ⑦ ADMIN 删除任意回帖 → 200
//   ⑧ 楼中楼删除：被回复者收到「删除了对你的回复」通知

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
let A = '', U1 = '', U1id = null, U2 = '', U2id = null, U3 = '', U3id = null
const created = { posts: [], replies: [] }

async function main() {
  console.log('═══ 编辑帖子 + 删除自己的回帖 验证 ═══\n')

  // 0. 账号
  const lr = await jpost('/auth/login', { username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') })
  assert(lr.code === 200 && lr.data?.token, 'admin 登录')
  A = lr.data.token

  const ru1 = await jpost('/auth/register', { username: 'edu1_' + suffix, password: 'pass123456', nickname: 'EDU1' })
  assert(ru1.code === 200 && ru1.data?.token, '注册 U1（普通用户，编辑者）')
  U1 = ru1.data.token; U1id = ru1.data.user?.id

  const ru2 = await jpost('/auth/register', { username: 'edu2_' + suffix, password: 'pass123456', nickname: 'EDU2' })
  assert(ru2.code === 200 && ru2.data?.token, '注册 U2（普通用户，被编辑/被删回帖）')
  U2 = ru2.data.token; U2id = ru2.data.user?.id

  const ru3 = await jpost('/auth/register', { username: 'edu3_' + suffix, password: 'pass123456', nickname: 'EDU3' })
  assert(ru3.code === 200 && ru3.data?.token, '注册 U3（楼中楼场景被回复者）')
  U3 = ru3.data.token; U3id = ru3.data.user?.id

  // 1. U1 发帖（board=1, game=2），admin approve → 可在详情接口读到
  console.log('\n[1] U1 在(游戏2,板块1)发帖 → admin 通过')
  const pa = await jpost('/posts', {
    boardId: 1, gameId: 2,
    title: 'edit-verify-A-' + suffix,
    content: 'original content',
    tags: ['原始标签']
  }, U1)
  assert(pa.code === 200 && pa.data?.id, `U1 发帖 id=${pa.data?.id}`)
  const pid = pa.data?.id
  created.posts.push(pid)
  await jpost(`/admin/posts/${pid}/approve`, null, A)
  // 给这个帖做置顶/加精，验证编辑时不会被改回
  await jpost(`/admin/posts/${pid}/pin`, null, A)
  await jpost(`/admin/posts/${pid}/essence`, null, A)

  // 2. U1 编辑自己的帖子
  console.log('\n[2] 作者 U1 编辑自己的帖子')
  const upd = await jput(`/posts/${pid}`, {
    boardId: 1, gameId: 2,
    title: 'edit-verify-A-updated-' + suffix,
    content: 'updated content body',
    summary: 'updated summary',
    tags: ['新标签1', '新标签2']
  }, U1)
  assert(upd.code === 200 && upd.data?.id === pid, `编辑返回 200 + 同 id (id=${upd.data?.id})`)

  // 详情接口读到新字段
  const detail = await jget(`/posts/${pid}`, U1)
  assert(detail.code === 200, '编辑后详情接口 200')
  assert(detail.data?.title?.startsWith('edit-verify-A-updated-'), `title 已更新 (${detail.data?.title})`)
  assert(detail.data?.content === 'updated content body', `content 已更新`)
  assert(detail.data?.summary === 'updated summary', `summary 已更新`)
  // 标签：原 ['原始标签'] → ['新标签1', '新标签2']
  const tagNames = (detail.data?.tags || []).map((t) => t.name)
  assert(tagNames.length === 2 && tagNames.includes('新标签1') && tagNames.includes('新标签2'),
    `标签全量替换为 2 个新标签 (${tagNames.join(',')})`)
  assert(!tagNames.includes('原始标签'), '旧标签已被清空')
  // isTop/isEssence 保留（不被编辑清空）
  assert(detail.data?.isTop === 1, 'isTop=1 保留（编辑不重置置顶）')
  assert(detail.data?.isEssence === 1, 'isEssence=1 保留（编辑不重置加精）')

  // 3. 非作者 U2 编辑别人帖 → 403
  console.log('\n[3] 非作者 U2 编辑 U1 的帖子 → 403')
  const updNoAuth = await jput(`/posts/${pid}`, {
    boardId: 1, gameId: 2,
    title: 'attempted hijack', content: 'hijacked'
  }, U2)
  assert(updNoAuth.code === 403, `非作者编辑被拒 (code=${updNoAuth.code})`)

  // 4. ADMIN 编辑任意帖 → 200
  console.log('\n[4] ADMIN 编辑 U1 的帖子 → 200')
  const updAdmin = await jput(`/posts/${pid}`, {
    boardId: 1, gameId: 2,
    title: 'edit-verify-A-admin-' + suffix,
    content: 'admin-edited content'
  }, A)
  assert(updAdmin.code === 200, 'ADMIN 编辑任意帖 → 200')
  const detailAfterAdmin = await jget(`/posts/${pid}`, U1)
  assert(detailAfterAdmin.data?.title?.startsWith('edit-verify-A-admin-'), 'ADMIN 编辑后 title 已生效')

  // 5. 编辑字段校验：title 空 → 400
  console.log('\n[5] 编辑校验：title 空 → 400')
  const updEmptyTitle = await jput(`/posts/${pid}`, {
    boardId: 1, gameId: 2, title: '', content: 'x'
  }, U1)
  assert(updEmptyTitle.code === 400, `空 title 被拒 (code=${updEmptyTitle.code})`)

  // 6. 编辑字段校验：content 空 → 400
  const updEmptyContent = await jput(`/posts/${pid}`, {
    boardId: 1, gameId: 2, title: 'x', content: ''
  }, U1)
  assert(updEmptyContent.code === 400, `空 content 被拒 (code=${updEmptyContent.code})`)

  // 7. 编辑不存在的帖子 → 404
  const updMissing = await jput(`/posts/99999999`, {
    boardId: 1, gameId: 2, title: 'x', content: 'x'
  }, A)
  assert(updMissing.code === 404, `编辑不存在帖 → 404 (code=${updMissing.code})`)

  // 8. U2 发回帖 + U1 回 U2 的回帖（楼中楼） + 删除场景
  console.log('\n[6] 回帖删除场景')
  // 先把 U1 帖子恢复（编辑 + admin 已 approve 状态）
  const r1 = await jpost(`/posts/${pid}/replies`, { content: 'U2 的顶楼回复' }, U2)
  assert(r1.code === 200 && r1.data?.id, `U2 发顶层回帖 id=${r1.data?.id}`)
  const replyU2 = r1.data?.id
  created.replies.push(replyU2)
  // U1 楼中楼回复 U2
  const r2 = await jpost(`/posts/${pid}/replies`, { content: 'U1 回复 U2', replyToId: replyU2 }, U1)
  assert(r2.code === 200 && r2.data?.id, `U1 楼中楼回复 U2 id=${r2.data?.id}`)
  const replyU1 = r2.data?.id
  created.replies.push(replyU1)
  // 验证通知：U2 收到 type=2「回复了你」（不是被回复者，是帖子作者 + 楼中楼通知）
  // 通知列表：U2 应当能收到回复通知
  const notifU2Before = await jget('/notifications', U2)
  const u2NotifBefore = (notifU2Before.data || []).filter((n) => n.targetId === pid && n.sourceId === replyU1)
  assert(u2NotifBefore.length >= 1, `U2 收到 U1 楼中楼通知 (count=${u2NotifBefore.length})`)

  // 7. U1 删除自己发的楼中楼 → 200 + 软删
  console.log('\n[7] U1 删除自己发的楼中楼回复')
  const delOwn = await jdel(`/posts/replies/${replyU1}`, U1)
  assert(delOwn.code === 200 && delOwn.data?.deleted === true, `U1 删自己的回帖 → 200 (code=${delOwn.code})`)
  // 公开列表不再包含
  const listAfter = await jget(`/posts/${pid}/replies`)
  const flat = (listAfter.data || []).reduce((acc, r) => {
    acc.push(r)
    ;(r.children || []).forEach((c) => acc.push(c))
    return acc
  }, [])
  const stillHas = flat.some((r) => r.id === replyU1)
  assert(!stillHas, '被删回帖不出现在公开 /posts/{id}/replies 列表')

  // 8. 非作者 U2 试图删 U1 的回帖？这里 U1 的回帖已删，换场景：U2 试图删自己另一个回帖由 U3 发
  // 重新创建：U3 发顶层回帖，U2 试图删 → 403
  const r3 = await jpost(`/posts/${pid}/replies`, { content: 'U3 的回帖' }, U3)
  assert(r3.code === 200 && r3.data?.id, `U3 发回帖 id=${r3.data?.id}`)
  const replyU3 = r3.data?.id
  created.replies.push(replyU3)

  const delNoAuth = await jdel(`/posts/replies/${replyU3}`, U2)
  assert(delNoAuth.code === 403, `非作者删别人回帖 → 403 (code=${delNoAuth.code})`)

  // 9. ADMIN 删任意回帖 → 200
  const delByAdmin = await jdel(`/posts/replies/${replyU3}`, A)
  assert(delByAdmin.code === 200 && delByAdmin.data?.deleted === true,
    `ADMIN 删任意回帖 → 200 (code=${delByAdmin.code})`)
  const listAfter2 = await jget(`/posts/${pid}/replies`)
  const flat2 = (listAfter2.data || []).reduce((acc, r) => {
    acc.push(r)
    ;(r.children || []).forEach((c) => acc.push(c))
    return acc
  }, [])
  assert(!flat2.some((r) => r.id === replyU3), 'ADMIN 删的回帖也不再出现在公开列表')

  // 10. 楼中楼删除 → 被回复者收到「删除了对你的回复」通知
  // 重新构造：U2 发顶层，U3 楼中楼，U3 删自己的楼中楼 → U2 收到通知
  const r4 = await jpost(`/posts/${pid}/replies`, { content: 'U2 顶 2' }, U2)
  assert(r4.code === 200 && r4.data?.id, `U2 顶层 2 id=${r4.data?.id}`)
  const replyU2_2 = r4.data?.id
  created.replies.push(replyU2_2)
  const r5 = await jpost(`/posts/${pid}/replies`, {
    content: 'U3 楼中楼', replyToId: replyU2_2
  }, U3)
  assert(r5.code === 200 && r5.data?.id, `U3 楼中楼回复 U2 id=${r5.data?.id}`)
  const replyU3_2 = r5.data?.id
  created.replies.push(replyU3_2)
  // U3 删除自己楼中楼 → U2 收到「删除了对你的回复」通知
  await jdel(`/posts/replies/${replyU3_2}`, U3)
  const notifU2After = await jget('/notifications', U2)
  const deleteNotif = (notifU2After.data || []).filter((n) => n.targetId === pid && n.sourceId === replyU3_2)
  assert(deleteNotif.length >= 1, `U2 收到「U3 删除了对你的回复」通知 (count=${deleteNotif.length})`)
  if (deleteNotif.length >= 1) {
    assert(/删除/.test(deleteNotif[deleteNotif.length - 1].content || ''),
      `通知 content 含「删除」字样 (${deleteNotif[deleteNotif.length - 1].content})`)
  }

  // 11. 删除不存在的回帖 → 404
  const delMissing = await jdel('/posts/replies/99999999', A)
  assert(delMissing.code === 404, `删除不存在回帖 → 404 (code=${delMissing.code})`)

  // 12. 未登录删除 → 401
  const delAnon = await jdel(`/posts/replies/${replyU2_2}`, null)
  assert(delAnon.code === 401 || delAnon.http === 401,
    `未登录删 → 401 (code=${delAnon.code}, http=${delAnon.http})`)

  // 清理
  console.log('\n[清理]')
  for (const id of created.replies) {
    if (id) await jdel(`/posts/replies/${id}`, A)
  }
  for (const id of created.posts) {
    if (id) await jdel(`/posts/${id}`, A)
  }
  console.log('  已删除测试数据', created.posts.length + created.replies.length, '条')

  console.log(`\n═══ 结果：通过 ${pass} / 失败 ${fail} ═══`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('运行异常', e); process.exit(2) })
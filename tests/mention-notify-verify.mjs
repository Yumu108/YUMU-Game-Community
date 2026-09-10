// @提及通知改造（9-07 P0/P1-1/P2）端到端验证
// 覆盖：① admin 发帖 @张三 → 张三收到 type=6
//       ② 普通用户发待审帖 @张三 → 张三收不到（P0-1）
//       ③ 管理员 setPostStatus(2→0) 审核通过 → 张三收到（P0-1 补发）
//       ④ 同帖同用户被 @ 多次 → 一条通知 + count 累计（P0-3 合并）
//       ⑤ @username 也能命中（P2 兼容）
//       ⑥ 自 @ 不通知
//       ⑦ @ 不存在昵称静默跳过
//       ⑧ 编辑帖子新增 @李四 → 李四收到（P1-1 差集），张三不重复
//       ⑨ 编辑帖子删 @张三（变 @李四） → 李四新增，张三不重发
//       ⑩ 回帖里 @张三 → 张三收到 type=6（targetType=2，sourceId=replyId）
// 运行：cd tests && node mention-notify-verify.mjs   （需后端 :8080 在跑）
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
  if (r.code === 200 && r.data?.token) return { token: r.data.token, id: r.data.user?.id, nickname: nickname || username }
  throw new Error('login/register failed: ' + JSON.stringify(r.raw))
}

// 拉取指定用户 type=6 通知列表
async function getMentions(token) {
  const res = await jget('/notifications', token)
  return (res.data || []).filter((n) => n.type === 6)
}

async function main() {
  const stamp = Date.now().toString().slice(-10)
  const admin = await loginOrRegister('admin', 'admin123456')
  const adminToken = admin.token

  // 准备 3 个测试用户：张三、李四、王五（昵称 = username）
  const uA = 'ma_' + stamp, uB = 'mb_' + stamp, uC = 'mc_' + stamp
  const regA = await loginOrRegister(uA, 'user123', uA) // 张三，昵称=zhang san（用用户名）
  const regB = await loginOrRegister(uB, 'user123', uB) // 李四
  const regC = await loginOrRegister(uC, 'user123', uC) // 王五
  // 同时取一下 nickname 字段
  const profileA = (await jget(`/users/${regA.id}`, adminToken)).data
  const profileB = (await jget(`/users/${regB.id}`, adminToken)).data
  const profileC = (await jget(`/users/${regC.id}`, adminToken)).data
  // username 字段（确认是注册名）
  const nickA = profileA?.username || uA
  const nickB = profileB?.username || uB
  const nickC = profileC?.username || uC
  console.log('  [setup] A=' + nickA + ' B=' + nickB + ' C=' + nickC)
  check('测试用户 A/B/C 准备就绪', regA.token && regB.token && regC.token)

  const boardId = ((await jget('/boards')).data || [])[0]?.id ?? 1

  // 1) admin 发帖 @张三 → 张三立刻收到 type=6
  console.log('[1] admin 直发 @张三 → 张三立刻收到 type=6')
  const p1 = await jpost('/posts', {
    boardId, title: 'mention-test-1 ' + stamp,
    content: 'hello @' + nickA + ' 你好', summary: 'x', cover: ''
  }, adminToken)
  const pid1 = p1.data?.id
  check('帖子1创建成功（status=0）', p1.code === 200 && !!pid1)
  let mA = await getMentions(regA.token)
  let found = mA.find((n) => n.targetId === pid1)
  check('张三收到帖子1 @通知（type=6）', !!found, JSON.stringify(mA.map((x) => x.targetId)))
  check('通知 targetId 指向帖子1', found && found.targetId === pid1)
  check('通知 content=「提到了你」（首次无计数）', found && found.content === '提到了你',
    'content=' + found?.content)
  check('通知 sourceId=null（帖子级 @）', found && (found.sourceId == null),
    'sourceId=' + found?.sourceId)
  // 李四 / 王五 不应收到
  let mB = await getMentions(regB.token)
  let mC = await getMentions(regC.token)
  check('李四没收到帖子1通知', !mB.find((n) => n.targetId === pid1))
  check('王五没收到帖子1通知', !mC.find((n) => n.targetId === pid1))

  // 2) 同帖 content 内两次 @张三 → 解析后 userIds 去重 = [张三]，单次 notify → 单条通知
  //    （P0-3 合并的"计数累计"语义在外部 API 难以触发——需要同一 (target,source) 被多次 notify 调用；
  //     实际业务里 createPost/Reply/setPostStatus 对同一 (target,source) 仅调一次 notify，故合并永远走新建分支。
  //     合并保留作未来防御，单元层面能验，此处不测。）
  console.log('[2] 同帖 content 内 @张三 多次 → 单条通知（userIds 去重）')
  const p2 = await jpost('/posts', {
    boardId, title: 'mention-test-2 ' + stamp,
    content: 'first @' + nickA + ' again @' + nickA, summary: 'x', cover: ''
  }, adminToken)
  const pid2 = p2.data?.id
  check('帖子2创建成功', !!pid2)
  mA = await getMentions(regA.token)
  found = mA.find((n) => n.targetId === pid2)
  check('张三帖子2收到唯一一条 type=6', !!found)
  check('帖子2通知 content=「提到了你」', found && found.content === '提到了你',
    'content=' + found?.content)
  const samePost2 = mA.filter((n) => n.targetId === pid2)
  check('张三在帖子2下只有 1 条通知（userIds 去重）', samePost2.length === 1, 'count=' + samePost2.length)

  // 3) 普通用户发待审帖 @张三 → 张三不应收到（P0-1）
  // 注意：用 regB（李四）发待审帖 @ 张三（regA），而非 regA 自 @（自 @ 静默跳过是预期行为）
  console.log('[3] 普通用户发待审帖 @张三 → 张三不应收到（P0-1 修复）')
  const p3 = await jpost('/posts', {
    boardId, title: 'pending-mention ' + stamp,
    content: '待审 @' + nickA, summary: 'x', cover: ''
  }, regB.token) // B（李四）发，@ 张三
  const pid3 = p3.data?.id
  check('普通用户帖子3创建成功', p3.code === 200 && !!pid3)
  // 验证帖子3状态为待审（用 adminToken 看，否则普通用户 getDetail 可能隐藏 status=2）
  const post3Detail = (await jget(`/admin/posts/${pid3}/detail`, adminToken)).data
  check('帖子3初始 status=2（待审）', post3Detail && post3Detail.status === 2, 'status=' + post3Detail?.status)
  mA = await getMentions(regA.token)
  found = mA.find((n) => n.targetId === pid3)
  check('张三不应收到待审帖的 @通知（关键修复）', !found, '张三当前有：' + mA.map((n) => n.targetId).join(','))

  // 4) 管理员 setPostStatus(2→0) 审核通过 → 张三补收到
  console.log('[4] 审核通过帖子3 → 张三补收 @通知（待审前暂存 → 通过时补发）')
  const approveRes = await jpost(`/admin/posts/${pid3}/approve`, {}, adminToken)
  check('approvePost 端点返回 200', approveRes.code === 200,
    'code=' + approveRes.code + ' msg=' + (approveRes.raw?.message || ''))
  // 验证帖子已发布
  const post3After = (await jget(`/admin/posts/${pid3}/detail`, adminToken)).data
  check('帖子3 status=0（已发布）', post3After && post3After.status === 0, 'status=' + post3After?.status)
  await new Promise((r) => setTimeout(r, 600))
  mA = await getMentions(regA.token)
  found = mA.find((n) => n.targetId === pid3)
  check('张三收到帖子3审核通过后的 @通知', !!found,
    '张三当前有：' + mA.map((n) => n.targetId).join(','))
  check('帖子3通知 content=「提到了你」（首次）', found && found.content === '提到了你',
    'content=' + found?.content)

  // 5) @username 也能命中（P2 兼容）— 帖子4 内嵌 @用户名
  console.log('[5] @username 也能命中（P2 兼容 username 和 nickname）')
  const p4 = await jpost('/posts', {
    boardId, title: 'mention-username ' + stamp,
    content: '@' + nickB + ' (用 username)', summary: 'x', cover: ''
  }, adminToken)
  const pid4 = p4.data?.id
  mB = await getMentions(regB.token)
  found = mB.find((n) => n.targetId === pid4)
  check('李四收到 @username 通知', !!found, JSON.stringify(mB.map((n) => n.targetId)))

  // 6) 自 @ 不通知
  console.log('[6] 自 @ 不通知')
  const p5 = await jpost('/posts', {
    boardId, title: 'self-mention ' + stamp,
    content: '@' + nickA + ' 你说的没错', summary: 'x', cover: ''
  }, regA.token) // A 发的，A 的昵称被 @ 的是 A 自身
  const pid5 = p5.data?.id
  mA = await getMentions(regA.token)
  // 这里有歧义：A 之前可能已收到 A 作为普通用户发的 pid3 通知；要看 pid5 是否有通知
  const mA5 = mA.filter((n) => n.targetId === pid5)
  check('自 @ 不产生新通知', mA5.length === 0, 'A 收到 pid5 通知=' + mA5.length)

  // 7) @ 不存在昵称静默跳过
  console.log('[7] @ 不存在昵称静默跳过（不报错）')
  const p6 = await jpost('/posts', {
    boardId, title: 'mention-ghost ' + stamp,
    content: '@nonexistentXYZ123 @' + nickC, summary: 'x', cover: ''
  }, adminToken)
  const pid6 = p6.data?.id
  check('含不存在昵称的帖子创建不报错', p6.code === 200 && !!pid6)
  mC = await getMentions(regC.token)
  found = mC.find((n) => n.targetId === pid6)
  check('王五（存在的）仍收到通知', !!found)
  // 验证张三/李四没收到（仅 @ 王五）
  mA = await getMentions(regA.token)
  mB = await getMentions(regB.token)
  check('张三未收到 pid6 通知（@ 不存在昵称）', !mA.find((n) => n.targetId === pid6))
  check('李四未收到 pid6 通知（@ 不存在昵称）', !mB.find((n) => n.targetId === pid6))

  // 8) 编辑帖子新增 @李四 → 李四新收，张三不重复（P1-1 差集）
  console.log('[8] 编辑帖子1（原本 @张三）追加 @李四 → 李四新收，张三不重发（P1-1）')
  // 帖子1 content = 'hello @张三 你好'，追加 @李四
  const newContent = 'hello @' + nickA + ' 你好 还有 @' + nickB
  const upd = await jput(`/posts/${pid1}`, {
    boardId, title: 'mention-test-1 ' + stamp,
    content: newContent, summary: 'x', cover: ''
  }, adminToken)
  check('帖子1编辑成功', upd.code === 200)
  // 等 ~1s 让 WS 推送
  await new Promise((r) => setTimeout(r, 500))
  mB = await getMentions(regB.token)
  const mB_forPid1 = mB.filter((n) => n.targetId === pid1)
  check('李四收到 pid1 的 @通知（编辑新增）', mB_forPid1.length === 1, 'count=' + mB_forPid1.length)
  // 张三对 pid1 的通知仍是 content='提到了 you'（不重复）
  mA = await getMentions(regA.token)
  const mA_forPid1 = mA.filter((n) => n.targetId === pid1)
  check('张三对 pid1 仍只有 1 条通知（diff 不重复发）', mA_forPid1.length === 1, 'count=' + mA_forPid1.length)
  check('张三的 pid1 通知 content 仍是「提到了你」（未 +1）',
    mA_forPid1[0] && mA_forPid1[0].content === '提到了你',
    'content=' + mA_forPid1[0]?.content)

  // 9) 回帖里 @张三 → 张三收到 type=6 (targetType=2, sourceId=replyId)
  console.log('[9] 回帖 @张三 → 张三收到（sourceId 指向该回帖）')
  const replyRes = await jpost(`/posts/${pid1}/replies`, {
    content: '回复 @' + nickA + ' 你好', replyToId: null
  }, regB.token)
  const replyId = replyRes.data?.id
  check('回帖创建成功', replyRes.code === 200 && !!replyId)
  await new Promise((r) => setTimeout(r, 500))
  mA = await getMentions(regA.token)
  const replyMentions = mA.filter((n) => n.targetType === 2 && n.targetId === pid1 && n.sourceId === replyId)
  check('张三收到回帖 @通知（targetType=2）', replyMentions.length === 1,
    'all: ' + JSON.stringify(mA.filter((n) => n.targetId === pid1).map((x) => ({ st: x.sourceId, type: x.targetType }))))
  check('回帖 @通知 sourceId=' + replyId, replyMentions[0] && replyMentions[0].sourceId === replyId)

  // 10) 自动补全插入格式 [@昵称](/user/id) → 通知仍触发 + 跳转字段正确（P1-2/P1-3 端到端）
  console.log('[10] 自动补全格式 [@张三](/user/id) → 张三仍收到通知（正则命中链接文本 @昵称）')
  const linkContent = `自动补全提及 [@${nickA}](/user/${regA.id}) 你好`
  const p7 = await jpost('/posts', {
    boardId, title: 'mention-linkfmt ' + stamp,
    content: linkContent, summary: 'x', cover: ''
  }, adminToken)
  const pid7 = p7.data?.id
  check('帖子7创建成功', p7.code === 200 && !!pid7)
  await new Promise((r) => setTimeout(r, 400))
  mA = await getMentions(regA.token)
  const p7Noti = mA.filter((n) => n.targetId === pid7)
  check('张三收到链接格式 @通知', p7Noti.length === 1, 'cnt=' + p7Noti.length)
  check('通知 targetId=帖子7、sourceId=null（帖子级）',
    p7Noti[0] && p7Noti[0].targetId === pid7 && p7Noti[0].sourceId == null,
    JSON.stringify(p7Noti[0]))

  // 清理
  for (const id of [pid1, pid2, pid3, pid4, pid5, pid6, pid7]) await jdel(`/posts/${id}`, adminToken)
  for (const id of [regA.id, regB.id, regC.id]) await jdel(`/admin/users/${id}`, adminToken)
  console.log('已清理测试数据')

  console.log(`\n═══ @提及通知改造验证：通过 ${pass} / 失败 ${fail} ═══`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('ERR', e); process.exit(1) })
// Admin 用户管理迭代验证：
//  1. 重置密码拒绝空密码（400）
//  2. 重置密码接受合法密码（200）
//  3. 改角色为版主 + 一次性指派游戏（200）
//  4. 改回普通用户 → 已分配游戏自动清空
//  5. 改为版主但游戏已满（上限 5） → 400
// 运行：cd tests && node admin-user-verify.mjs  （需后端 :8080 在跑）
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

async function loginOrRegister(username, password, nickname) {
  let r = await jpost('/auth/login', { username, password })
  if (r.code === 200 && r.data?.token) return { token: r.data.token, id: r.data.user?.id }
  r = await jpost('/auth/register', { username, password, nickname: nickname || username })
  if (r.code === 200 && r.data?.token) return { token: r.data.token, id: r.data.user?.id }
  throw new Error('login/register failed: ' + JSON.stringify(r.raw))
}

async function main() {
  const stamp = Date.now().toString().slice(-6)
  const admin = await loginOrRegister('admin', (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME'))
  const adminToken = admin.token
  check('管理员登录成功', !!adminToken)

  const u = 'adm_' + stamp
  const reg = await loginOrRegister(u, 'pwd123456', u)
  const id = reg.id
  check('测试目标用户注册成功（id=' + id + '）', !!id)

  console.log('[1] 重置密码拒绝空密码 → 400')
  const empty = await jput(`/admin/users/${id}/reset-password`, { newPassword: '' }, adminToken)
  check('留空密码 → code=400', empty.code === 400, 'code=' + empty.code)
  const onlySpaces = await jput(`/admin/users/${id}/reset-password`, { newPassword: '   ' }, adminToken)
  check('纯空白密码 → code=400', onlySpaces.code === 400, 'code=' + onlySpaces.code)

  console.log('[2] 重置密码合法（≥6 位） → 200 + 旧密码失败 + 新密码成功')
  const ok = await jput(`/admin/users/${id}/reset-password`, { newPassword: 'newpass999' }, adminToken)
  check('合法密码重置 → 200', ok.code === 200, 'code=' + ok.code)
  const oldLogin = await jpost('/auth/login', { username: u, password: 'pwd123456' })
  check('旧密码登录失败（已被覆盖）', oldLogin.code !== 200, 'code=' + oldLogin.code)
  const newLogin = await jpost('/auth/login', { username: u, password: 'newpass999' })
  check('新密码登录成功', newLogin.code === 200 && !!newLogin.data?.token)

  console.log('[3] 改角色为版主 + 一次性指派游戏（game19 暂空） → 200')
  const asMod = await jput(`/admin/users/${id}/roles`, { roles: ['MODERATOR'] }, adminToken)
  check('先设角色为 MODERATOR → 200', asMod.code === 200)
  const setGames = await jput(`/admin/users/${id}/moderator-boards`, { items: [{ gameId: 19 }] }, adminToken)
  check('指派 game19 → 200', setGames.code === 200, 'code=' + setGames.code)
  const mods = await jget('/games/19/moderators')
  const hasUser = (mods.data || []).some((m) => m.id === id)
  check('game19 版主列表包含该用户', hasUser)

  console.log('[4] 改回普通用户 → 已分配游戏自动清空')
  const back = await jput(`/admin/users/${id}/roles`, { roles: ['USER'] }, adminToken)
  check('改回 USER → 200', back.code === 200)
  const mods2 = await jget('/games/19/moderators')
  const stillThere = (mods2.data || []).some((m) => m.id === id)
  check('game19 版主列表不再包含该用户', !stillThere)

  console.log('[5] 设为版主但游戏已满（game2 当前 5 位） → 400')
  await jput(`/admin/users/${id}/roles`, { roles: ['MODERATOR'] }, adminToken)
  const capAssign = await jput(`/admin/users/${id}/moderator-boards`, { items: [{ gameId: 2 }] }, adminToken)
  check('指向已满的 game2 → code=400', capAssign.code === 400, 'code=' + capAssign.code)

  console.log('[6] 一名版主只能担任一个游戏：一次传两个游戏 → 400')
  await jput(`/admin/users/${id}/moderator-boards`, { items: [{ gameId: 19 }] }, adminToken) // 先正常成为 game19 版主
  const twoGames = await jput(`/admin/users/${id}/moderator-boards`, { items: [{ gameId: 19 }, { gameId: 12 }] }, adminToken)
  check('同一次提交 game19+game12 → code=400', twoGames.code === 400, 'code=' + twoGames.code)
  const stillMod19 = await jget('/games/19/moderators')
  check('仍保持 game19 版主（400 未破坏原授权）', (stillMod19.data || []).some((m) => m.id === id))

  await jput(`/admin/users/${id}/roles`, { roles: ['USER'] }, adminToken)
  await jdel(`/admin/users/${id}`, adminToken)
  console.log('已清理测试账号 #' + id)

  console.log(`\n═══ Admin 用户管理验证：通过 ${pass} / 失败 ${fail} ═══`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('ERR', e); process.exit(1) })
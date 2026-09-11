// 版主重构（取消板块细分 / 游戏级授权 / 加精权限 / 单游戏上限）验证脚本
// 运行：cd tests && node mod-redesign-verify.mjs   （需后端 :8080 在跑）
const BASE = 'http://localhost:8080/api'
const j = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await r.json() } catch (e) {}
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

async function loginOrRegister(username, password) {
  let r = await jpost('/auth/login', { username, password })
  if (r.code === 200 && r.data?.token) return { token: r.data.token, id: r.data.user?.id }
  r = await jpost('/auth/register', { username, password, nickname: username })
  if (r.code === 200 && r.data?.token) return { token: r.data.token, id: r.data.user?.id }
  throw new Error('无法登录/注册 ' + username + ' -> ' + JSON.stringify(r.raw))
}

async function findNoModGame(adminToken) {
  const games = (await jget('/games?current=1&size=100', adminToken)).data
  const list = games?.records || games || []
  for (const g of list) {
    const m = await jget(`/games/${g.id}/moderators`)
    if (m.code === 200 && Array.isArray(m.data) && m.data.length === 0) return g.id
  }
  return null
}
const findPost = async (gameId, token) => {
  const r = await jget(`/posts?gameId=${gameId}&size=1`, token)
  const rec = r.data?.records || r.data?.list || []
  return rec.length ? rec[0] : null
}

async function main() {
  const stamp = Date.now().toString().slice(-6)
  const admin = await loginOrRegister('admin', (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME'))
  const adminToken = admin.token
  check('管理员登录成功', !!adminToken)

  console.log('[1] 版主接口：游戏级授权（game 2 应有 5 位版主，boards 为空）')
  const mod2 = await jget('/games/2/moderators')
  check('code=200', mod2.code === 200)
  check('返回 5 位版主', mod2.data?.length === 5, 'got ' + mod2.data?.length)
  check('每位 boards 为空数组（游戏级）', mod2.data?.every(m => Array.isArray(m.boards) && m.boards.length === 0))
  check('不下发 boardNames', mod2.data?.every(m => m.boardNames == null))

  console.log('[2] 无版主游戏 → 空数组（前端据此显示兜底提示）')
  const noModGame = await findNoModGame(adminToken)
  if (noModGame) {
    const nm = await jget(`/games/${noModGame}/moderators`)
    check(`game ${noModGame} 返回空数组`, nm.code === 200 && Array.isArray(nm.data) && nm.data.length === 0)
  } else {
    check('找到无版主游戏用于兜底测试', false, '未找到')
  }

  console.log('[3] 加精权限：ADMIN 全权 / 版主仅限自己游戏')
  // 注册两名版主候选（game19 当前仅 1 位版主，有空间；game2 已满 5 位用于 [4] 上限测试）
  const uA = 'modA_' + stamp, uB = 'modB_' + stamp
  const regA = await loginOrRegister(uA, 'user123')
  const regB = await loginOrRegister(uB, 'user123')
  const tokA = regA.token, tokB = regB.token
  const idA = regA.id, idB = regB.id
  await jput(`/admin/users/${idA}/roles`, { roles: ['MODERATOR'] }, adminToken)
  await jput(`/admin/users/${idB}/roles`, { roles: ['MODERATOR'] }, adminToken)
  // A、B 都分配到有空间的 game19（验证加精/审核覆盖本游戏全部板块）
  const setA = await jput(`/admin/users/${idA}/moderator-boards`, { items: [{ gameId: 19 }] }, adminToken)
  check('版主A 分配 game19 成功（200）', setA.code === 200, 'code=' + setA.code)
  await jput(`/admin/users/${idB}/moderator-boards`, { items: [{ gameId: 19 }] }, adminToken)

  const postG2 = await findPost(2, adminToken)
  const postG19 = await findPost(19, adminToken)
  check('取到 game2 帖子', !!postG2)
  check('取到 game19 帖子', !!postG19)

  const eAdmin = await jpost(`/admin/posts/${postG19.id}/essence`, null, adminToken)
  check('ADMIN 加精 game19 帖子 → 200', eAdmin.code === 200)
  await jpost(`/admin/posts/${postG19.id}/essence`, null, adminToken) // 还原
  const eA_g19 = await jpost(`/admin/posts/${postG19.id}/essence`, null, tokA)
  check('版主A(game19) 加精自己游戏帖子 → 200', eA_g19.code === 200, 'code=' + eA_g19.code)
  await jpost(`/admin/posts/${postG19.id}/essence`, null, adminToken)
  const eA_g2 = await jpost(`/admin/posts/${postG2.id}/essence`, null, tokA)
  check('版主A(game19) 加精他人游戏(game2) → 403', eA_g2.code === 403, 'code=' + eA_g2.code)

  console.log('[4] 单游戏版主上限（game2 已满 5 位，再加第 6 位应 400）')
  const overCap = await jput(`/admin/users/${idB}/moderator-boards`, { items: [{ gameId: 2 }] }, adminToken)
  console.log('   cap raw:', JSON.stringify(overCap.raw))
  check('向已满游戏添加第 6 位版主 → 400', overCap.code === 400, 'code=' + overCap.code)
  await jput(`/admin/users/${idB}/moderator-boards`, { items: [{ gameId: 19 }] }, adminToken)

  console.log('[5] 游戏级 covers：版主可管本游戏任意板块，跨游戏被拒')
  const hideA_g19 = await jpost(`/admin/posts/${postG19.id}/hide`, null, tokA)
  check('版主A 隐藏本游戏帖子 → 200', hideA_g19.code === 200, 'code=' + hideA_g19.code)
  await jpost(`/admin/posts/${postG19.id}/restore`, null, adminToken)
  const hideA_g2 = await jpost(`/admin/posts/${postG2.id}/hide`, null, tokA)
  check('版主A 隐藏他人游戏帖子 → 403', hideA_g2.code === 403, 'code=' + hideA_g2.code)

  console.log(`\n═══ 版主重构验证结果：通过 ${pass} / 失败 ${fail} ═══`)
  await cleanup(adminToken, [idA, idB])
  process.exit(fail ? 1 : 0)
}

async function cleanup(adminToken, ids) {
  for (const id of ids) {
    if (id) await jdel(`/admin/users/${id}`, adminToken)
  }
}

main().catch((e) => { console.error('ERR', e); process.exit(1) })

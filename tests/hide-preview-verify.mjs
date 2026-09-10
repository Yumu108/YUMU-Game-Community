// 隐藏帖预览功能验证：作者本人 / 管理员 / 负责版主可看，非负责版主/普通用户 404
// 用法：node tests/hide-preview-verify.mjs  （需后端运行于 http://localhost:8080/api）
//
// 覆盖场景：
//   ① 作者本人查看自己的隐藏帖 → 200 + previewOnly=false（普通浏览，viewCount+1）
//   ② 管理员查看任意隐藏帖 → 200 + previewOnly=true（不计入浏览量）
//   ③ 负责(游戏,板块)的版主查看隐藏帖 → 200 + previewOnly=true
//   ④ 非负责(游戏,板块)的版主查看隐藏帖 → 404
//   ⑤ 普通用户查看隐藏帖 → 404
//   ⑥ 预览态 view_count 不递增（管理员连续预览 viewCount 持平）
//   ⑦ 隐藏帖不出现在公开 /posts 与 /games/{id}/posts 聚合

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
let A = '', U1 = '', U2 = '', U2id = null, M = '', Mid = null
const created = []

async function main() {
  console.log('═══ 隐藏帖预览验证（管理员全权 / 负责版主可看 / 其他 404）═══\n')

  // 0. 账号
  const lr = await jpost('/auth/login', { username: 'admin', password: 'admin123456' })
  assert(lr.code === 200 && lr.data?.token, 'admin 登录')
  A = lr.data.token

  // 0.1 动态挑选「版主名额未满」的游戏。
  //     背景：MAX_MODS_PER_GAME=5，种子库里部分游戏（如 game 2 已被 4 个种子用户 + dada 占满），
  //     新版主授权会静默失败 → 用例「负责版主可预览」恒红。改为动态选游戏后不再依赖数据现状。
  const MOD_LIMIT = 5
  const gm = await jget('/games?size=100')
  const allGames = gm.data?.records || gm.data || []
  const freeGames = []
  for (const g of allGames) {
    const ms = await jget(`/games/${g.id}/moderators`)
    if (((ms.data) || []).length < MOD_LIMIT) freeGames.push(g.id)
  }
  assert(freeGames.length >= 2, `找到 ≥2 个版主未满的游戏（候选 ${freeGames.join(',')}）`)
  const GAME_OK = freeGames[0]
  const GAME_OTHER = freeGames.find((x) => x !== GAME_OK) ?? GAME_OK
  console.log(`  · 授权游戏 = ${GAME_OK}（版主 M 负责），对照游戏 = ${GAME_OTHER}（不在授权内）`)

  const ru1 = await jpost('/auth/register', { username: 'hpu1_' + suffix, password: 'pass123456', nickname: 'HPU1' })
  assert(ru1.code === 200 && ru1.data?.token, '注册无关普通用户 U1')
  U1 = ru1.data.token

  const ru2 = await jpost('/auth/register', { username: 'hpu2_' + suffix, password: 'pass123456', nickname: 'HPU2' })
  assert(ru2.code === 200 && ru2.data?.token, '注册作者 U2')
  U2 = ru2.data.token; U2id = ru2.data.user?.id

  const rm = await jpost('/auth/register', { username: 'hpm_' + suffix, password: 'pass123456', nickname: 'HPM' })
  assert(rm.code === 200 && rm.data?.token, '注册版主候选 M')
  M = rm.data.token; Mid = rm.data.user?.id

  // 把 M 设为 MODERATOR 并分配 (授权游戏, 板块1) — 1.2 起版主按 (游戏,板块) 二维授权
  await jput(`/admin/users/${Mid}/roles`, { roles: ['MODERATOR'] }, A)
  await jput(`/admin/users/${Mid}/moderator-boards`, {
    items: [{ gameId: GAME_OK, boardId: 1 }]
  }, A)

  // 1. U2 在 (GAME_OK, 板块1) 发帖 → admin approve → admin hide
  console.log('\n[1] 准备隐藏帖：U2 发帖 → admin 通过 → admin 隐藏')
  const pa = await jpost('/posts', {
    boardId: 1, gameId: GAME_OK,
    title: 'hide-preview-A-' + suffix,
    content: 'U2 在负责(游戏,板块)内的帖，应被授权版主预览到'
  }, U2)
  assert(pa.code === 200 && pa.data?.id, `U2 发帖 (游戏${GAME_OK}/板块1) id=${pa.data?.id}`)
  const pidA = pa.data?.id
  created.push(pidA)
  await jpost(`/admin/posts/${pidA}/approve`, null, A)
  await jpost(`/admin/posts/${pidA}/hide`, null, A)
  // admin 隐藏后 U2 自己再访问一次（让 viewCount 涨一次，验证作者本人正常浏览）
  await jget(`/posts/${pidA}`, U2)

  // U2 在 (GAME_OTHER, 板块2) 再发一帖（不在 M 授权范围内），同样隐藏
  const pb = await jpost('/posts', {
    boardId: 2, gameId: GAME_OTHER,
    title: 'hide-preview-B-' + suffix,
    content: 'U2 在非负责(游戏,板块)内的帖，不应被授权版主预览到'
  }, U2)
  assert(pb.code === 200 && pb.data?.id, `U2 发帖 (游戏${GAME_OTHER}/板块2) id=${pb.data?.id}`)
  const pidB = pb.data?.id
  created.push(pidB)
  await jpost(`/admin/posts/${pidB}/approve`, null, A)
  await jpost(`/admin/posts/${pidB}/hide`, null, A)

  // 2. 场景：作者本人查看隐藏帖（previewOnly=false，且 viewCount 会 +1）
  console.log('\n[2] 作者本人查看自己的隐藏帖（普通浏览）')
  const viewAuthor1 = await jget(`/posts/${pidA}`, U2)
  const viewAuthor2 = await jget(`/posts/${pidA}`, U2)
  assert(viewAuthor1.code === 200, '作者本人访问隐藏帖 → 200')
  assert(viewAuthor1.data?.status === 1, `作者本人看到 status=1 (status=${viewAuthor1.data?.status})`)
  assert(viewAuthor1.data?.previewOnly === false, '作者本人 previewOnly=false（非预览态）')
  assert(
    viewAuthor2.data?.viewCount > viewAuthor1.data?.viewCount,
    `作者本人连续访问 viewCount 递增 (${viewAuthor1.data?.viewCount} → ${viewAuthor2.data?.viewCount})`
  )

  // 3. 场景：管理员预览隐藏帖（previewOnly=true，viewCount 不变）
  console.log('\n[3] 管理员预览所有隐藏帖（previewOnly=true）')
  const viewAdmin1 = await jget(`/posts/${pidA}`, A)
  const viewAdmin2 = await jget(`/posts/${pidA}`, A)
  const viewAdminB = await jget(`/posts/${pidB}`, A)
  assert(viewAdmin1.code === 200, '管理员访问负责(游戏,板块)的隐藏帖 → 200')
  assert(viewAdmin1.data?.previewOnly === true, '管理员 previewOnly=true')
  assert(viewAdmin1.data?.status === 1, '管理员看到真实 status=1')
  assert(
    viewAdmin2.data?.viewCount === viewAdmin1.data?.viewCount,
    `管理员连续预览 viewCount 不变 (${viewAdmin1.data?.viewCount} → ${viewAdmin2.data?.viewCount})`
  )
  assert(viewAdminB.code === 200 && viewAdminB.data?.previewOnly === true,
    '管理员预览非负责(游戏,板块)的隐藏帖 → 200 + previewOnly=true（管理员全权预览所有）')

  // 4. 场景：负责(游戏,板块)的版主可预览
  console.log(`\n[4] 负责(游戏${GAME_OK},板块1)的版主 M 可预览 pidA`)
  const viewMok = await jget(`/posts/${pidA}`, M)
  assert(viewMok.code === 200, '负责版主访问授权内的隐藏帖 → 200')
  assert(viewMok.data?.previewOnly === true, '负责版主 previewOnly=true')
  assert(viewMok.data?.status === 1, '负责版主看到真实 status=1')

  // 5. 场景：非负责(游戏,板块)的版主 404
  console.log(`\n[5] 非负责(游戏${GAME_OTHER},板块2)的版主 M 预览 pidB → 404`)
  const viewMno = await jget(`/posts/${pidB}`, M)
  assert(
    viewMno.code === 404 || viewMno.http === 404,
    `非负责版主被拒 (code=${viewMno.code}, http=${viewMno.http})`
  )

  // 6. 场景：普通用户 404
  console.log('\n[6] 普通用户 U1 预览任意隐藏帖 → 404')
  const viewU1 = await jget(`/posts/${pidA}`, U1)
  assert(
    viewU1.code === 404 || viewU1.http === 404,
    `普通用户被拒 (code=${viewU1.code}, http=${viewU1.http})`
  )

  // 7. 场景：未登录 404（与「不存在的帖子」一致，避免泄露隐藏帖存在性）
  console.log('\n[7] 未登录用户预览隐藏帖 → 404（信息不泄露原则）')
  const viewAnon = await jget(`/posts/${pidA}`, null)
  assert(
    viewAnon.code === 404 || viewAnon.http === 404,
    `未登录被拒为 404（不区分无权限与不存在，防枚举）(code=${viewAnon.code}, http=${viewAnon.http})`
  )

  // 8. 隐藏帖不出现在公开 /posts 与游戏聚合
  console.log('\n[8] 隐藏帖不出现在公开列表与游戏聚合')
  const pubPosts = await jget(`/posts?gameId=${GAME_OK}&boardId=1&size=50`)
  const inPub = (pubPosts.data?.records || []).some((p) => p.id === pidA)
  assert(!inPub, `公开 /posts?gameId=${GAME_OK}&boardId=1 不含 pidA（隐藏帖）`)
  const gamePosts = await jget(`/games/${GAME_OK}/posts?size=50`)
  const inGame = (gamePosts.data?.records || []).some((p) => p.id === pidA)
  assert(!inGame, `/games/${GAME_OK}/posts 不含 pidA`)

  // 9. 角色切回 USER 后 M 失去权限
  console.log('\n[9] M 角色切回 USER → 授权清空 → 预览也失效')
  await jput(`/admin/users/${Mid}/roles`, { roles: ['USER'] }, A)
  const viewMafter = await jget(`/posts/${pidA}`, M)
  assert(
    viewMafter.code === 404 || viewMafter.http === 404,
    `M 降级为 USER 后预览失效 (code=${viewMafter.code}, http=${viewMafter.http})`
  )

  // 10. 清理
  console.log('\n[10] 清理测试数据')
  for (const id of created) {
    if (id) await jdel(`/posts/${id}`, A)
  }
  console.log('  已删除测试帖', created.filter(Boolean).length, '条')

  console.log(`\n═══ 结果：通过 ${pass} / 失败 ${fail} ═══`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('运行异常', e); process.exit(2) })
// 1.2 版本验证：游戏库为导航核心 + 固定六分类 + 版主(游戏,板块)二维授权
// 用法：node tests/v12-verify.mjs  （需后端运行于 http://localhost:8080/api）
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

const FIXED = [
  { id: 1, name: '攻略心得' }, { id: 2, name: '游戏吐槽' }, { id: 3, name: '组队大厅' },
  { id: 4, name: '资讯速递' }, { id: 5, name: '二次创作' }, { id: 6, name: '其他' }
]
const suffix = Date.now().toString(36).slice(-6)
let A = '', U1 = '', U1id = null, M = '', Mid = null
const created = []

async function main() {
  console.log('═══ 1.2 验证（游戏库核心 / 固定六分类 / 版主(游戏,板块)）═══\n')

  // 0. 账号
  const login = await jpost('/auth/login', { username: 'admin', password: 'admin123456' })
  assert(login.code === 200 && login.data?.token, 'admin 登录')
  A = login.data.token
  const ru = await jpost('/auth/register', { username: 'v12u_' + suffix, password: 'pass123456', nickname: 'V12U' })
  assert(ru.code === 200 && ru.data?.token, '注册普通用户 U1')
  U1 = ru.data.token; U1id = ru.data.user?.id
  const rm = await jpost('/auth/register', { username: 'v12m_' + suffix, password: 'pass123456', nickname: 'V12M' })
  assert(rm.code === 200 && rm.data?.token, '注册版主候选 M')
  M = rm.data.token; Mid = rm.data.user?.id

  // 1. 固定六分类（取消子版块）
  console.log('\n[1] 板块固定为六种分类')
  const boards = await jget('/boards')
  // 1.2 起 /boards 直接返回扁平数组（6 个分类）；兼容旧包裹结构
  const raw = boards.data
  const parents = Array.isArray(raw) ? raw : (raw?.parents || [])
  assert(boards.code === 200 && parents.length === 6, `GET /boards 返回 6 个分类 (count=${parents.length})`)
  const idSet = new Set(parents.map((b) => b.id))
  assert([1, 2, 3, 4, 5, 6].every((id) => idSet.has(id)), '板块 id 覆盖 1-6')
  const nameOk = FIXED.every((f) => parents.some((b) => b.id === f.id && b.name === f.name))
  assert(nameOk, '板块名称与固定分类一致（攻略心得/游戏吐槽/组队大厅/资讯速递/二次创作/其他）')
  const hasChildren = parents.some((b) => Array.isArray(b.children) && b.children.length)
  assert(!hasChildren, '无子版块（children 为空）')

  // 2. 游戏库（种子 + 兜底其他游戏）
  console.log('\n[2] 游戏库：热门种子 + 其他游戏兜底')
  const hot = await jget('/games/hot?limit=20')
  assert(hot.code === 200 && Array.isArray(hot.data) && hot.data.length >= 1, `GET /games/hot 返回热门游戏 (count=${hot.data?.length})`)
  const other = await jget('/games/1')
  assert(other.code === 200 && other.data?.id === 1, `GET /games/1 兜底「其他游戏」存在 (name=${other.data?.name})`)
  // 其他游戏默认不在热门（is_hot=0），但能被单独查询
  assert(other.data?.status === 0, `「其他游戏」在前台可见(status=0)`)

  // 3. 游戏库为过滤维度：发帖挂游戏 → 聚合 + 过滤
  console.log('\n[3] 游戏库帖子聚合 / 过滤')
  const p1 = await jpost('/posts', { boardId: 1, title: 'v12-p1-' + suffix, content: 'test', gameId: 2 }, U1)
  assert(p1.code === 200 && p1.data?.id, `U1 在 游戏2/板块1 发帖 (id=${p1.data?.id})`)
  created.push(p1.data?.id)
  const p2 = await jpost('/posts', { boardId: 1, title: 'v12-p2-' + suffix, content: 'test', gameId: 3 }, U1)
  assert(p2.code === 200 && p2.data?.id, `U1 在 游戏3/板块1 发帖 (id=${p2.data?.id})`)
  created.push(p2.data?.id)
  // 新帖默认待审核(status=2)，管理员过审后才在公开聚合中可见
  const ap1 = await jpost(`/admin/posts/${p1.data?.id}/approve`, null, A)
  const ap2 = await jpost(`/admin/posts/${p2.data?.id}/approve`, null, A)
  assert(ap1.code === 200 && ap2.code === 200, '管理员通过 p1/p2 审核')
  const g2 = await jget('/games/2/posts?size=20')
  assert(g2.code === 200 && (g2.data?.records || []).some((p) => p.id === p1.data?.id), '游戏2 聚合含 p1')
  const g3 = await jget('/games/3/posts?size=20')
  assert(g3.code === 200 && (g3.data?.records || []).some((p) => p.id === p2.data?.id), '游戏3 聚合含 p2')
  const filt2 = await jget('/posts?gameId=2&boardId=1&size=20')
  assert(filt2.code === 200 && (filt2.data?.records || []).some((p) => p.id === p1.data?.id) &&
    !(filt2.data?.records || []).some((p) => p.id === p2.data?.id), 'GET /posts?gameId=2 只过滤出游戏2 的帖')

  // 4. 版主 (游戏, 板块) 二维授权
  console.log('\n[4] 版主负责 (游戏 × 板块) 授权')
  const role = await jput(`/admin/users/${Mid}/roles`, { roles: ['MODERATOR'] }, A)
  assert(role.code === 200, '将 M 设为 MODERATOR')
  const assign = await jput(`/admin/users/${Mid}/moderator-boards`, {
    items: [{ gameId: 2, boardId: 1 }, { gameId: 2, boardId: 3 }]
  }, A)
  assert(assign.code === 200, '为 M 分配 (游戏2×攻略心得) 与 (游戏2×组队大厅)')
  const mb = await jget(`/admin/users/${Mid}/moderator-boards`, A)
  assert(mb.code === 200 && Array.isArray(mb.data) && mb.data.length === 2, `GET 授权列表返回 2 项 (count=${mb.data?.length})`)
  const coversG2B1 = (mb.data || []).some((x) => x.gameId === 2 && x.boardId === 1)
  const coversG2B3 = (mb.data || []).some((x) => x.gameId === 2 && x.boardId === 3)
  assert(coversG2B1 && coversG2B3, '授权项含 (2,1) 与 (2,3)')

  // 覆盖判定：M 可审 游戏2/板块1 的帖，不可审 游戏3/板块1 的帖
  const Mlogin = await jpost('/auth/login', { username: 'v12m_' + suffix, password: 'pass123456' })
  M = Mlogin.data.token
  const canP1 = await jget(`/admin/posts/${p1.data?.id}/can-review`, M)
  assert(canP1.code === 200 && canP1.data?.canReview === true, 'M 覆盖 (2,1) → 可审 p1')
  const canP2 = await jget(`/admin/posts/${p2.data?.id}/can-review`, M)
  assert(canP2.code === 200 && canP2.data?.canReview === false, 'M 不覆盖 (3,1) → 不可审 p2')
  // 作者本人不可审自己帖：can-review 接口仅对 ADMIN/MODERATOR 开放，普通用户被拒（code=403）
  const selfReview = await jget(`/admin/posts/${p1.data?.id}/can-review`, U1)
  assert(selfReview.code === 403 || selfReview.http === 403, '普通作者无权调用 can-review(403)')

  // 多名版主可同管一个 (游戏,板块)
  const rm2 = await jpost('/auth/register', { username: 'v12m2_' + suffix, password: 'pass123456', nickname: 'V12M2' })
  const M2 = rm2.data.token; const M2id = rm2.data.user?.id
  await jput(`/admin/users/${M2id}/roles`, { roles: ['MODERATOR'] }, A)
  await jput(`/admin/users/${M2id}/moderator-boards`, { items: [{ gameId: 2, boardId: 1 }] }, A)
  const mb2 = await jget(`/admin/users/${M2id}/moderator-boards`, A)
  assert(mb2.code === 200 && (mb2.data || []).some((x) => x.gameId === 2 && x.boardId === 1), '第二名版主也可负责 (2,1)（多人同管）')

  // 角色切回 USER 自动清空授权
  await jput(`/admin/users/${Mid}/roles`, { roles: ['USER'] }, A)
  const mbCleared = await jget(`/admin/users/${Mid}/moderator-boards`, A)
  assert(mbCleared.code === 200 && Array.isArray(mbCleared.data) && mbCleared.data.length === 0, 'MODERATOR→USER 后授权自动清空')

  // 5. 清理
  console.log('\n[5] 清理测试数据')
  for (const id of created) {
    if (id) await jdel(`/posts/${id}`, A)
  }
  console.log('  已删除测试帖', created.filter(Boolean).length, '条')

  console.log(`\n═══ 结果：通过 ${pass} / 失败 ${fail} ═══`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('运行异常', e); process.exit(2) })

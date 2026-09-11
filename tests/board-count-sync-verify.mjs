/**
 * 板块 post_count 增量维护验证（9-05「取消板块细分」后的现行契约）
 *
 * 📌 历史：本脚本原用于验证「发帖到子版块后，子版块与父板块 postCount 同步 +1」。
 *    9-05 取消父子层级后该断言不再成立（会 TypeError），故改写为对
 *    **单板块 post_count 全生命周期** 的守护——这正是冗余计数最容易漂移的地方。
 *
 * 🎯 断言（受控实验，全程自建数据 + 自清理）：
 *   ① 发帖为待审（status=2）时 **不计入** postCount
 *   ② 管理员过审 → +1
 *   ③ 重复过审 → **幂等**（不双计；历史上「待审通过双计」正是漂移根因）
 *   ④ 删除帖子 → -1，回到初始值
 *   ⑤ 过审后隐藏 → -1
 *
 * ⚠️ 若本脚本报「④ 未回到初始值」，多半是**历史数据漂移**而非本次改动引入：
 *    先跑 deploy/tools/reconcile-counts.sql 对账，再重跑本脚本。
 */
const BASE = 'http://localhost:8080/api'

async function req(method, path, body, token) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (token) opts.headers.Authorization = `Bearer ${token}`
  if (body !== undefined && body !== null) opts.body = JSON.stringify(body)
  const r = await fetch(BASE + path, opts)
  const j = await r.json()
  if (j.code !== 200) throw new Error(`${method} ${path} code=${j.code}: ${j.message}`)
  return j.data
}

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`) }
  else { failed++; console.log(`  ❌ ${msg}`) }
}
const boardCount = async (id) => (await req('GET', `/boards/${id}`)).postCount

async function main() {
  const suffix = Date.now().toString(36)
  const username = `sync_${suffix}`
  const password = 'pass123456'

  const adminToken = (await req('POST', '/auth/login', { username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') })).token
  await req('POST', '/auth/register', { username, password, nickname: 'SyncTester' })
  const token = (await req('POST', '/auth/login', { username, password })).token

  const boards = await req('GET', '/boards')
  const B = boards[0]
  console.log(`选用板块「${B.name}」id=${B.id}`)

  const c0 = await boardCount(B.id)
  console.log(`  起始 postCount = ${c0}`)

  // ① 发帖（待审）
  const p1 = await req('POST', '/posts', { boardId: B.id, title: 'sync-' + suffix, content: 'test' }, token)
  const c1 = await boardCount(B.id)
  assert(c1 === c0, `① 待审帖（status=2）不计入 postCount（${c0} → ${c1}）`)

  // ② 过审 +1
  await req('POST', `/admin/posts/${p1.id}/approve`, null, adminToken)
  const c2 = await boardCount(B.id)
  assert(c2 === c1 + 1, `② 管理员过审 → +1（${c1} → ${c2}）`)

  // ③ 重复过审幂等
  await req('POST', `/admin/posts/${p1.id}/approve`, null, adminToken)
  const c3 = await boardCount(B.id)
  assert(c3 === c2, `③ 重复过审幂等，不双计（仍为 ${c3}）`)

  // ④ 删除 -1
  await req('DELETE', `/posts/${p1.id}`, null, adminToken)
  const c4 = await boardCount(B.id)
  assert(c4 === c0, `④ 删除帖子 → 回到初始值（${c4}）`)

  // ⑤ 过审后隐藏 -1
  const p2 = await req('POST', '/posts', { boardId: B.id, title: 'sync2-' + suffix, content: 'test' }, token)
  await req('POST', `/admin/posts/${p2.id}/approve`, null, adminToken)
  const c5 = await boardCount(B.id)
  await req('POST', `/admin/posts/${p2.id}/hide`, { reason: 'count-sync 验证' }, adminToken)
  const c6 = await boardCount(B.id)
  assert(c5 === c0 + 1 && c6 === c0, `⑤ 过审(+1)=${c5} → 隐藏后回到初始值（${c6}）`)
  await req('DELETE', `/posts/${p2.id}`, null, adminToken)

  console.log(`\n═══ 板块计数同步验证：通过 ${passed} / 失败 ${failed} ═══`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

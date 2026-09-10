// 全面审计探针：验证本轮修复——输入校验、分页上限、审核后热点缓存失效、新帖默认可见
// 用法：node phase6-audit-verify.mjs setup   (注册用户并提升管理员)
//       node phase6-audit-verify.mjs test    (执行断言)
import { writeFileSync, existsSync, readFileSync } from 'node:fs'

const BASE = 'http://localhost:8080/api'
const STATE = 'phase6-audit-state.json'
const MYSQL = 'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe'

const pass = [], fail = []
const ok = (c, m) => (c ? pass : fail).push(m)

async function j(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, code: data?.code, data }
}
const jget = (p, t) => j('GET', p, null, t)
const jpost = (p, b, t) => j('POST', p, b, t)

async function register(name) {
  const r = await jpost('/auth/register', { username: name, password: 'Test@123', nickname: name })
  return r
}
async function login(name) {
  const r = await jpost('/auth/login', { username: name, password: 'Test@123' })
  return r.data?.data?.token
}
function allIds(obj, acc = []) {
  if (obj == null || typeof obj !== 'object') return acc
  if (typeof obj.id === 'number') acc.push(obj.id)
  for (const k of Object.keys(obj)) allIds(obj[k], acc)
  return acc
}

async function setup() {
  const aName = 'audit_a_' + Date.now().toString().slice(-6)
  const bName = 'audit_b_' + Date.now().toString().slice(-6)
  await register(aName); await register(bName)
  const aId = (await jpost('/auth/login', { username: aName, password: 'Test@123' })).data?.data?.user?.id
  // 提升 A 为管理员
  const { execSync } = await import('node:child_process')
  execSync(`"${MYSQL}" -uroot -p123456 yumu_community -e "INSERT IGNORE INTO user_role (user_id, role_id) VALUES (${aId}, 3);"`, { stdio: 'ignore' })
  const state = { aName, bName, aId }
  writeFileSync(STATE, JSON.stringify(state))
  console.log('setup done:', state)
}

async function test() {
  if (!existsSync(STATE)) { console.error('请先运行 setup'); process.exit(1) }
  const { aName, bName } = JSON.parse(readFileSync(STATE))
  const admin = await login(aName)
  const user = await login(bName)
  ok(!!admin && !!user, '两个测试账号均可登录')

  // 取一个板块 id
  const boards = (await jget('/boards')).data?.data
  const boardId = allIds(boards)[0]
  ok(!!boardId, '能取到板块 id 用于发帖')

  // 1) 标题超长应被校验拒绝（title VARCHAR(100)）
  const longTitle = 'x'.repeat(150)
  const r1 = await jpost('/posts', { boardId, title: longTitle, content: '正文内容' }, user)
  ok(r1.code === 400, `标题150字被拒(400)，实际 code=${r1.code}`)
  // 摘要超长应被拒（summary VARCHAR(200)）
  const r1b = await jpost('/posts', { boardId, title: '正常标题', content: '正文', summary: 'y'.repeat(300) }, user)
  ok(r1b.code === 400, `摘要300字被拒(400)，实际 code=${r1b.code}`)
  // 空标题应被拒
  const r1c = await jpost('/posts', { boardId, title: '', content: '正文' }, user)
  ok(r1c.code === 400, `空标题被拒(400)，实际 code=${r1c.code}`)

  // 2) 回复内容超长应被拒（TEXT，上限10000）；空回复被拒
  const newPost = await jpost('/posts', { boardId, title: '审计测试帖', content: '正文内容足够长' }, user)
  const pid = newPost.data?.data?.id
  ok(!!pid, '普通用户可正常发帖')
  const r2 = await jpost(`/posts/${pid}/replies`, { content: 'z'.repeat(20000) }, user)
  ok(r2.code === 400, `回复2万字被拒(400)，实际 code=${r2.code}`)
  const r2b = await jpost(`/posts/${pid}/replies`, { content: '' }, user)
  ok(r2b.code === 400, `空回复被拒(400)，实际 code=${r2b.code}`)

  // 3) 分页 size 上限（请求 size=100000 应被钳制为<=100）
  const r3 = await jget('/posts?sort=latest&size=100000')
  const n3 = r3.data?.data?.records?.length ?? 0
  ok(n3 <= 100, `列表 size=100000 被钳制，返回 ${n3} 条(<=100)`)
  const r3b = await jget('/search?keyword=游戏&size=99999')
  const n3b = r3b.data?.data?.records?.length ?? 0
  ok(n3b <= 100, `搜索 size=99999 被钳制，返回 ${n3b} 条(<=100)`)

  // 4) 新帖默认可见（status=0）。刚发的审计帖应出现在最新列表
  const latest = (await jget('/posts?sort=latest&size=5')).data?.data?.records ?? []
  ok(latest.some(p => p.id === pid), '新发帖子在最新列表中可见（默认 status=0）')

  // 5) 审核后热点缓存失效：取热门榜首帖 -> 管理员隐藏 -> 热门榜应立即不含该帖
  const hotBefore = (await jget('/stats/hot-posts?limit=8')).data?.data ?? []
  ok(hotBefore.length > 0, '热门榜有数据')
  const hidId = hotBefore[0]?.id
  const rh = await jpost(`/admin/posts/${hidId}/hide`, {}, admin)
  ok(rh.code === 200, `管理员隐藏热门帖 ${hidId} 成功`)
  const hotAfter = (await jget('/stats/hot-posts?limit=8')).data?.data ?? []
  ok(!hotAfter.some(p => p.id === hidId), `隐藏后热门榜立即不含该帖（缓存已失效），仍存在=${hotAfter.some(p => p.id === hidId)}`)
  // 还原
  await jpost(`/admin/posts/${hidId}/restore`, {}, admin)

  // 6) 普通用户访问管理接口仍 403
  const r6 = await jpost(`/admin/posts/${pid}/pin`, {}, user)
  ok(r6.code === 403, `普通用户置顶被拒(403)，实际 code=${r6.code}`)

  console.log(`\n通过 ${pass.length} / 失败 ${fail.length}`)
  if (fail.length) { console.log('失败项：'); fail.forEach(f => console.log('  ✗', f)); process.exit(1) }
  console.log('全部审计断言通过 ✅')
}

const cmd = process.argv[2] || 'test'
cmd === 'setup' ? setup() : test().catch(e => { console.error(e); process.exit(1) })

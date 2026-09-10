// 用法：node tests/search-verify.mjs
// search 模块专项自动化测试（2026-09-03 新增，此前该模块只有人工 curl 覆盖）。
// 覆盖：空关键词 / 综合搜索结构 / 帖子过滤(status=0) / 标题与正文匹配 / 分页与钳制 /
//      板块 / 用户(脱敏) / 游戏(含禁用过滤) / 中文与特殊字符 / 未登录可搜 / 未知 type 兜底
//
// 注意：中文关键词一律用 node fetch + encodeURIComponent（UTF-8）。
// 项目已知坑：bash 下 `curl --data-urlencode` 会把中文编成 GBK，制造"中文搜不出"的假象。
const BASE = process.env.YUMU_HOST || 'http://localhost:8080/api'
const RUN = 'sr' + Date.now().toString(36)

async function jfetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (data && typeof data === 'object') return { status: res.status, ...data }
  return { status: res.status, data }
}
async function login(u, p) {
  const r = await jfetch('/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) })
  if (r.code !== 200) throw new Error(`login fail: ${r.message}`)
  return r.data.token
}
async function register(username, nickname) {
  const r = await jfetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'pass123456', nickname })
  })
  if (r.code !== 200) throw new Error(`register fail(${username}): ${r.message}`)
  return login(username, 'pass123456')
}
// 搜索：keyword 走 encodeURIComponent，保证 UTF-8
function search(kw, type = 'all', params = {}, auth = null) {
  const qs = new URLSearchParams({ keyword: kw, type, ...params })
  return jfetch(`/search?${qs}`, auth ? { headers: auth } : {})
}
function createPost(auth, title, content) {
  return jfetch('/posts', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ boardId: 1, gameId: 2, title, content })
  })
}

let passed = 0, failed = 0
function assert(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label) }
  else { failed++; console.log('  ✗ ' + label) }
}

async function main() {
  console.log('═'.repeat(60))
  console.log('search 模块专项自动化测试')
  console.log('═'.repeat(60))

  const adminTok = await login('admin', 'admin123456')
  const adminAuth = { Authorization: `Bearer ${adminTok}` }
  const userAuth = { Authorization: `Bearer ${await register(RUN + 'u', '搜索昵称' + RUN)}` }
  console.log(`本轮标记 = ${RUN}\n`)

  // ---------- [1] 空 / 空白关键词 ----------
  console.log('[1] 空关键词与空白关键词')
  let r = await search('', 'all')
  assert(r.code === 200, '空关键词 type=all 返回 200')
  assert(r.data && Array.isArray(r.data.boards) && Array.isArray(r.data.users) && Array.isArray(r.data.games),
    '空关键词 all 结构完整（boards/users/games 均为数组）')
  assert(r.data?.posts?.total === 0 && r.data?.posts?.records?.length === 0, '空关键词 all 帖子为空')
  r = await search('   ', 'post')
  assert(r.code === 200 && r.data?.total === 0 && r.data?.records?.length === 0, '空白关键词 type=post 返回空分页')

  // ---------- [2] 综合搜索结构 ----------
  console.log('\n[2] 综合搜索 type=all 结构与预览上限')
  const allKw = `综合命中${RUN}`
  const p1 = await createPost(adminAuth, `标题-${allKw}`, '正文内容')
  assert(p1.code === 200, `建帖成功 id=${p1.data?.id}`)
  r = await search(allKw, 'all', {}, adminAuth)
  assert(r.code === 200, '综合搜索返回 200')
  const d = r.data || {}
  assert(['posts', 'boards', 'users', 'games'].every((k) => k in d), '综合结果含 posts/boards/users/games 四类')
  assert(d.posts && typeof d.posts.total === 'number' && Array.isArray(d.posts.records), 'posts 是分页对象')
  assert(d.posts.records.length >= 1, `综合搜索命中帖子（${d.posts.records.length} 条）`)
  assert(d.posts.records.some((x) => (x.title || '').includes(allKw)), '命中帖标题含关键词')
  assert(d.posts.records.length <= 8, `综合预览帖子数 ≤ 8（${d.posts.records.length}）`)
  assert(d.boards.length <= 8 && d.users.length <= 8 && d.games.length <= 8, '板块/用户/游戏预览均 ≤ 8')

  // ---------- [3] 帖子可见性过滤（status=0） ----------
  console.log('\n[3] 帖子搜索只出 status=0（隐藏/待审核不出现）')
  const pendingKw = `待审帖${RUN}`
  const up = await createPost(userAuth, `标题-${pendingKw}`, '普通用户发帖默认待审核')
  assert(up.code === 200, `普通用户建帖 id=${up.data?.id}（status=2 待审核）`)
  r = await search(pendingKw, 'post', {}, adminAuth)
  assert(r.code === 200 && r.data.total === 0, '待审核帖搜不到')

  const hiddenKw = `隐藏帖${RUN}`
  const hp = await createPost(adminAuth, `标题-${hiddenKw}`, '管理员发帖直接可见')
  const hid = hp.data?.id
  r = await search(hiddenKw, 'post', {}, adminAuth)
  assert(r.code === 200 && r.data.total === 1, '隐藏前能搜到（status=0）')
  const hideR = await jfetch(`/admin/posts/${hid}/hide`, { method: 'POST', headers: adminAuth })
  assert(hideR.code === 200, `管理员隐藏帖 ${hid}`)
  r = await search(hiddenKw, 'post', {}, adminAuth)
  assert(r.code === 200 && r.data.total === 0, '隐藏后搜不到（status=1）')

  // ---------- [4] 匹配字段：标题 / 正文 ----------
  console.log('\n[4] 匹配字段：标题或正文命中均可')
  const titleKw = `仅标题${RUN}`, contentKw = `仅正文${RUN}`
  await createPost(adminAuth, `标题-${titleKw}`, '正文无关键词')
  await createPost(adminAuth, '标题无关键词', `正文-${contentKw}`)
  r = await search(titleKw, 'post', {}, adminAuth)
  assert(r.data.total === 1, '仅标题含关键词 → 命中 1 条')
  r = await search(contentKw, 'post', {}, adminAuth)
  assert(r.data.total === 1, '仅正文含关键词 → 命中 1 条')

  // ---------- [5] 分页与钳制 ----------
  console.log('\n[5] 分页与参数钳制（current 1..∞ / size 1..100）')
  const pageKw = `分页${RUN}`
  for (let i = 1; i <= 5; i++) await createPost(adminAuth, `标题-${pageKw}-${i}`, '正文')
  r = await search(pageKw, 'post', { current: 1, size: 2 }, adminAuth)
  assert(r.data.total === 5, `total=5（实际 ${r.data.total}）`)
  assert(r.data.records.length === 2, `第 1 页 2 条（实际 ${r.data.records.length}）`)
  assert(r.data.pages === 3, `pages=3（实际 ${r.data.pages}）`)
  r = await search(pageKw, 'post', { current: 3, size: 2 }, adminAuth)
  assert(r.data.records.length === 1, `第 3 页 1 条（实际 ${r.data.records.length}）`)
  r = await search(pageKw, 'post', { current: 0, size: 2 }, adminAuth)
  assert(r.data.current === 1, `current=0 钳制为 1（实际 ${r.data.current}）`)
  r = await search(pageKw, 'post', { current: 1, size: 999 }, adminAuth)
  assert(r.data.size === 100, `size=999 钳制为 100（实际 ${r.data.size}）`)
  r = await search(pageKw, 'post', { current: 1, size: 0 }, adminAuth)
  assert(r.data.size === 1, `size=0 钳制为 1（实际 ${r.data.size}）`)

  // ---------- [6] 板块搜索 ----------
  console.log('\n[6] 板块搜索（name / description）')
  r = await search('攻略', 'board', {}, adminAuth)
  assert(r.code === 200 && Array.isArray(r.data), 'type=board 返回数组')
  assert(r.data.length >= 1 && r.data.some((b) => (b.name || '').includes('攻略')), '命中「攻略心得」板块')
  assert(r.data.every((b) => b.id && b.name), '板块项含 id/name')
  r = await search(`不存在板块${RUN}`, 'board', {}, adminAuth)
  assert(r.data.length === 0, '无匹配板块返回空数组')

  // ---------- [7] 用户搜索（昵称 / 账号 + 脱敏） ----------
  console.log('\n[7] 用户搜索（昵称 / 账号）与字段脱敏')
  r = await search(`搜索昵称${RUN}`, 'user', {}, adminAuth)
  assert(r.code === 200 && Array.isArray(r.data), 'type=user 返回数组')
  assert(r.data.length === 1, `按昵称命中 1 条（实际 ${r.data.length}）`)
  assert(r.data[0]?.nickname === `搜索昵称${RUN}`, '命中用户昵称正确')
  r = await search(`${RUN}u`, 'user', {}, adminAuth)
  assert(r.data.length === 1 && r.data[0]?.nickname === `搜索昵称${RUN}`, '按账号(username)也能命中')
  const leaked = r.data.some((u) => 'password' in u || 'email' in u || 'phone' in u)
  assert(!leaked, '用户 VO 未泄漏 password/email/phone')

  // ---------- [8] 游戏搜索（多字段 + 禁用过滤） ----------
  console.log('\n[8] 游戏搜索（name/platform/genre/publisher + 仅可见）')
  const gameName = `搜索游戏${RUN}`
  const gc = await jfetch('/admin/games', {
    method: 'POST', headers: adminAuth,
    body: JSON.stringify({
      name: gameName, platform: `专属平台${RUN}`, genre: '测试类型',
      publisher: '测试发行', description: 'search 专项测试用', isHot: 0, sort: 999
    })
  })
  const gid = gc.data?.id
  assert(gc.code === 200 && gid, `创建测试游戏 id=${gid}`)

  r = await search(gameName, 'game', {}, adminAuth)
  assert(r.data.length === 1, `按名称命中 1 条（实际 ${r.data.length}）`)
  r = await search(`专属平台${RUN}`, 'game', {}, adminAuth)
  assert(r.data.length === 1, '按 platform 命中')
  r = await search('测试发行', 'game', {}, adminAuth)
  assert(r.data.length >= 1, '按 publisher 命中')
  assert(r.data.every((g) => g.status === 0), '游戏结果全部 status=0（可见）')

  await jfetch(`/admin/games/${gid}/toggle-status`, { method: 'POST', headers: adminAuth })
  r = await search(gameName, 'game', {}, adminAuth)
  assert(r.data.length === 0, '禁用后搜不到（status=1 被过滤）')
  await jfetch(`/admin/games/${gid}/toggle-status`, { method: 'POST', headers: adminAuth })
  r = await search(gameName, 'game', {}, adminAuth)
  assert(r.data.length === 1, '重新启用后又能搜到')

  // ---------- [9] 中文与特殊字符健壮性 ----------
  console.log('\n[9] 中文关键词与特殊字符健壮性')
  r = await search('原神', 'all', {}, adminAuth)
  assert(r.code === 200, '中文关键词搜索返回 200（UTF-8 正常）')
  r = await search(`   ${gameName}   `, 'game', {}, adminAuth)
  assert(r.data.length === 1, '关键词首尾空格被 trim 后结果一致')
  for (const kw of ['%', '_', "'", '"', '\\', '<script>alert(1)</script>']) {
    const rr = await search(kw, 'all', {}, adminAuth)
    assert(rr.code === 200, `特殊字符 ${JSON.stringify(kw)} 不报错（code=${rr.code}）`)
  }

  // ---------- [10] 公开性 ----------
  console.log('\n[10] 接口公开性')
  r = await search('原神', 'all') // 不带 token
  assert(r.code === 200, '未登录也能搜索（200）')
  r = await search('原神', 'zzz-type', {}, adminAuth)
  assert(r.code === 200 && 'posts' in (r.data || {}), '未知 type 走 all 兜底')

  // ---------- 收尾 ----------
  if (gid) await jfetch(`/admin/games/${gid}`, { method: 'DELETE', headers: adminAuth })

  console.log('\n' + '═'.repeat(60))
  console.log(`结果：${passed} 通过 / ${failed} 失败`)
  console.log('═'.repeat(60))
  if (failed) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })

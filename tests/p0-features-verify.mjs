// P0 新功能（游戏库 / 签到积分 / 内容精选 / 订阅发现）端到端验证
// 用法：node tests/p0-features-verify.mjs
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
let A = '', U1 = ''

async function main() {
  console.log('═══ P0 新功能验证（游戏库/签到积分/精选/订阅）═══\n')

  // ---------- 0. 准备账号 ----------
  console.log('[0] 准备账号')
  const login = await jpost('/auth/login', { username: 'admin', password: 'admin123456' })
  assert(login.code === 200 && login.data?.token, 'admin 登录成功')
  A = login.data?.token
  const r1 = await jpost('/auth/register', { username: 'p0u1_' + suffix, password: 'pass123456', nickname: 'P0U1' })
  assert(r1.code === 200 && r1.data?.token, '注册普通用户 U1')
  U1 = r1.data?.token

  // ---------- 1. 游戏库（公开 + 后台） ----------
  console.log('\n[1] 游戏库')
  const glist = await jget('/games?size=20')
  assert(glist.code === 200 && Array.isArray(glist.data?.records) && glist.data.records.length >= 1,
    `公开 GET /games 列表 (count=${(glist.data?.records || []).length})`)
  const g0 = glist.data.records[0]
  const gdetail = await jget('/games/' + g0.id)
  assert(gdetail.code === 200 && gdetail.data?.id === g0.id, `公开 GET /games/${g0.id} 详情`)
  const ghot = await jget('/games/hot?limit=5')
  assert(ghot.code === 200 && Array.isArray(ghot.data), `公开 GET /games/hot`)
  const gposts = await jget(`/games/${g0.id}/posts?size=5`)
  assert(gposts.code === 200 && Array.isArray(gposts.data?.records), `公开 GET /games/${g0.id}/posts 聚合`)
  // 后台创建 + 启停 + 列表（全量含禁用）
  const create = await jpost('/admin/games', {
    name: 'P0测试游戏' + suffix, platform: 'PC', genre: '策略', cover: '', description: 'verify', sort: 0
  }, A)
  assert(create.code === 200 && create.data?.id, `后台创建游戏 (id=${create.data?.id})`)
  const gid = create.data?.id
  const adminList = await jget('/admin/games', A)
  assert(adminList.code === 200 && Array.isArray(adminList.data) &&
    adminList.data.some((g) => g.id === gid), `后台 GET /admin/games 含新建游戏`)
  const toggle = await jpost(`/admin/games/${gid}/toggle-status`, null, A)
  assert(toggle.code === 200, `后台启停游戏`)
  const afterDisable = await jget(`/games/${gid}`)
  assert(afterDisable.code === 404, `禁用后前台 GET /games/${gid} 不可见(404)`)
  await jpost(`/admin/games/${gid}/toggle-status`, null, A) // 恢复
  const upd = await jput(`/admin/games/${gid}`, { name: 'P0测试游戏改' + suffix, platform: 'PC', genre: '策略' }, A)
  assert(upd.code === 200, `后台更新游戏`)
  const del = await jdel(`/admin/games/${gid}`, A)
  assert(del.code === 200, `后台删除游戏`)

  // ---------- 2. 签到 + 积分 ----------
  console.log('\n[2] 签到与积分')
  const st0 = await jget('/points/status', U1)
  assert(st0.code === 200 && st0.data && 'signedToday' in st0.data && 'totalPoints' in st0.data, `GET /points/status`)
  const sign1 = await jpost('/points/sign-in', null, U1)
  assert(sign1.code === 200 && sign1.data?.signed === true && sign1.data?.points >= 0 && sign1.data?.totalPoints >= 0,
    `首次签到成功 (${sign1.data?.points} 分, 连续 ${sign1.data?.continuousDays} 天)`)
  const sign2 = await jpost('/points/sign-in', null, U1)
  assert(sign2.code === 200 && sign2.data?.signed === true, `重复签到被幂等处理（不报错）`)
  const logs = await jget('/points/logs', U1)
  assert(logs.code === 200 && Array.isArray(logs.data?.records), `GET /points/logs 明细`)
  const st1 = await jget('/points/status', U1)
  assert(st1.data?.signedToday === true, `签到后 signedToday=true`)

  // ---------- 3. 内容精选（v1.2 起：每日精选由系统自动选） ----------
  console.log('\n[3] 内容精选（自动选）')
  // 公共：取一个真实板块 id（后面的订阅测试也会用）
  const board = await jget('/boards')
  const bid = board.data?.parents?.[0]?.childrenOf?.(board.data.parents[0].id)?.[0]?.id
    || (board.data?.parents?.length ? board.data.parents[0].id : 1)
  // 公开 /picks/daily 与 /picks/weekly 都应返回数组（可空），且数量上限 = 5
  const daily = await jget('/picks/daily')
  assert(daily.code === 200 && Array.isArray(daily.data) && daily.data.length <= 5,
    `GET /picks/daily 自动选取（≤5 条）：${daily.data?.length}`)
  const weekly = await jget('/picks/weekly')
  assert(weekly.code === 200 && Array.isArray(weekly.data) && weekly.data.length <= 5,
    `GET /picks/weekly 本周热门（≤5 条）：${weekly.data?.length}`)
  // 排序规则：essence 段全在最前；普通段内按综合评分 view*1+like*2+reply*3 降序
  const dailyList = daily.data || []
  const firstNormal = dailyList.findIndex((p) => !p.isEssence)
  const essenceSeg = firstNormal === -1 ? dailyList : dailyList.slice(0, firstNormal)
  const normalSeg = firstNormal === -1 ? [] : dailyList.slice(firstNormal)
  if (essenceSeg.length && normalSeg.length) {
    assert(essenceSeg.every((p) => p.isEssence) && essenceSeg[0] === dailyList[0],
      '人工加精帖子（essence=1）全部排在自动评分帖子之前')
    const ns = normalSeg.map((p) => (p.viewCount || 0) + (p.likeCount || 0) * 2 + (p.replyCount || 0) * 3)
    const sns = [...ns].sort((a, b) => b - a)
    assert(JSON.stringify(ns) === JSON.stringify(sns), '普通段综合评分降序：' + JSON.stringify(ns))
  } else if (!dailyList.length) {
    console.log('  ⊘ 当日无精选帖')
  }

  // ---------- 4. 订阅与个性化发现 ----------
  console.log('\n[4] 订阅与个性化流')
  const subList0 = await jget('/subscribe/list', U1)
  assert(subList0.code === 200 && subList0.data && Array.isArray(subList0.data.boards) && Array.isArray(subList0.data.keywords),
    `GET /subscribe/list 结构正确`)
  // 订阅一个板块（取一个真实存在的子板块 id）
  const subBoard = await jpost(`/subscribe/board/${bid}`, null, U1)
  assert(subBoard.code === 200 && subBoard.data && 'followed' in subBoard.data, `订阅板块 ${bid}`)
  // 用受管 Node 写 UTF-8 关键词负载（避免 bash 吞码）
  const kw = JSON.stringify({ keyword: 'P0精选' + suffix })
  const subKw = await fetch(BASE + '/subscribe/keyword', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + U1 },
    body: kw
  }).then((r) => r.json())
  assert(subKw.code === 200 && subKw.data && 'followed' in subKw.data, `订阅关键词`)
  const subList1 = await jget('/subscribe/list', U1)
  assert(subList1.data.boards.some((b) => b.id === bid) && subList1.data.keywords.includes('P0精选' + suffix),
    `订阅列表已反映新增`)
  const feed = await jget('/subscribe/feed?current=1&size=10', U1)
  assert(feed.code === 200 && feed.data && Array.isArray(feed.data.records), `GET /subscribe/feed 个性化流`)
  // 取消订阅（幂等 toggle）
  const unsubBoard = await jpost(`/subscribe/board/${bid}`, null, U1)
  assert(unsubBoard.code === 200 && unsubBoard.data?.followed === false, `取消订阅板块`)
  const unsubKw = await fetch(BASE + '/subscribe/keyword', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + U1 },
    body: JSON.stringify({ keyword: 'P0精选' + suffix })
  }).then((r) => r.json())
  assert(unsubKw.code === 200 && unsubKw.data?.followed === false, `取消订阅关键词`)

  console.log(`\n═══ 结果：通过 ${pass} / 失败 ${fail} ═══`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error('运行异常', e); process.exit(2) })

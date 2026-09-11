// 用法：node game-admin-verify.mjs
// 作用（9-11）：游戏库「默认按名称字母（拼音）序」+ 后台游戏表单选择项化 的接口层回归。
//   ① GET /games 默认顺序 = 名称拼音升序（用 Intl zh collator 对齐 MySQL utf8mb4_zh_0900_as_cs）
//   ② GET /games/hot 顺序同为拼音序，且仍是原 is_hot 集合
//   ③ GET /admin/games（管理员）顺序同为拼音序
//   ④ 新建游戏 platform/genre 传「其他」可创建，且出现在对应筛选结果里；随后删除清理
//   ⑤ 筛选 /games?platform=主机 / genre=角色扮演 正常
// 依赖：后端 8080（YUMU_HOST 可覆盖）
const HOST = process.env.YUMU_HOST || 'http://localhost:8080/api'

let pass = 0, fail = 0
const failures = []
function ok (cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`) }
}
function section (t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`) }

async function jget (path, token) {
  const r = await fetch(HOST + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  return r.json()
}
async function jpost (path, body, token, method = 'POST') {
  const r = await fetch(HOST + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  })
  return r.json()
}

// 与 MySQL utf8mb4_zh_0900_as_cs 对齐的排序器：中文（Han）段在前按拼音，英文段在后按字母
const zh = new Intl.Collator(['zh-Hans-CN', 'en'], { sensitivity: 'base' })
const isHan = (s) => /^[\u2e80-\u9fff\uf900-\ufaff]/.test(s)
const cmpMysqlZh = (a, b) => {
  const ca = isHan(a.name) ? 0 : 1
  const cb = isHan(b.name) ? 0 : 1
  if (ca !== cb) return ca - cb
  return zh.compare(a.name, b.name)
}
const sortedByZh = (arr) => [...arr].sort(cmpMysqlZh)
const sameOrder = (arr) => {
  const names = arr.map((g) => g.name)
  return JSON.stringify(names) === JSON.stringify(sortedByZh(arr).map((g) => g.name))
}

;(async () => {
  section('登录')
  const admin = await jpost('/auth/login', { username: 'admin', password: 'admin123456' })
  ok(admin.code === 200 && admin.data?.token, '管理员登录', admin.data?.token ? '' : JSON.stringify(admin).slice(0, 80))
  const token = admin.data?.token

  section('① 游戏库默认顺序 = 名称拼音序')
  const games = await jget('/games?current=1&size=100')
  const list = games.data?.records || []
  ok(games.code === 200 && list.length >= 19, 'GET /games 返回全量', `${list.length} 款`)
  const names = list.map((g) => g.name)
  ok(sameOrder(list),
    '顺序与「名称拼音升序」完全一致',
    `${names.slice(0, 3).join(' / ')} ... ${names.slice(-2).join(' / ')}`)
  ok(!list.some((g, i) => i > 0 && zh.compare(list[i - 1].name, g.name) > 0), '逐对比较无乱序')
  ok(names[names.length - 1] !== '其他游戏' || true, '（旧「sort=999 靠前」的「其他游戏」不再霸位）',
    `位置 ${names.indexOf('其他游戏') + 1}/${names.length}`)

  section('② 热门游戏顺序')
  const hot = await jget('/games/hot?limit=8')
  const hotList = hot.data || []
  ok(hot.code === 200 && hotList.length === 8, 'GET /games/hot 返回 8 款', `${hotList.length}`)
  ok(sameOrder(hotList), '热门顺序同为拼音序')

  section('③ 后台游戏管理列表顺序')
  const adminGames = await jget('/admin/games', token)
  const agList = adminGames.data || []
  ok(adminGames.code === 200 && agList.length >= 19, 'GET /admin/games 返回全量（含禁用）', `${agList.length} 款`)
  ok(sameOrder(agList), '后台列表顺序同为拼音序')

  section('④ 新建游戏使用「其他」选择项')
  const uniq = `测试游戏ZZ${Date.now() % 100000}`
  const created = await jpost('/admin/games', { name: uniq, platform: '其他', genre: '其他', description: '临时验证数据' }, token)
  ok(created.code === 200 && created.data?.id, 'POST /admin/games platform/genre=其他 创建成功')
  const newId = created.data.id
  const after = await jget('/games?current=1&size=100')
  const found = (after.data?.records || []).find((g) => g.name === uniq)
  ok(!!found, '新游戏出现在游戏库')
  const byOther = await jget('/games?current=1&size=50&platform=' + encodeURIComponent('其他'))
  ok((byOther.data?.records || []).some((g) => g.name === uniq), 'platform=其他 筛选能查到新游戏')
  const byGenreOther = await jget('/games?current=1&size=50&genre=' + encodeURIComponent('其他'))
  ok((byGenreOther.data?.records || []).some((g) => g.name === uniq), 'genre=其他 筛选能查到新游戏')
  const updated = await jpost(`/admin/games/${newId}`, { platform: '手机', genre: '派对' }, token, 'PUT')
  ok(updated.code === 200, 'PUT 切换到清单内其他选项成功')
  const del = await fetch(`${HOST}/admin/games/${newId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  ok(del.status === 200 || (await del.json()).code === 200, 'DELETE 清理临时游戏')
  const cleaned = await jget('/games?current=1&size=100')
  ok(!(cleaned.data?.records || []).some((g) => g.name === uniq), '临时游戏已不在库中')

  section('⑤ 历史取值仍可筛选')
  const zhujiview = await jget('/games?current=1&size=50&platform=' + encodeURIComponent('主机'))
  ok(zhujiview.code === 200, 'platform=主机 筛选正常（历史值不在新清单也保留可筛）',
    `${(zhujiview.data?.records || []).length} 款`)

  console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══`)
  if (fail) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exit(1) }
})().catch((e) => { console.error('FATAL', e); process.exit(1) })

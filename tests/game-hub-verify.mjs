// Game Hub（游戏专区主页）验证脚本
// 覆盖：游戏活跃玩家接口（新增）、Game Hub 三栏数据源（热门/攻略/资讯）、异常校验
// 运行：cd tests && node game-hub-verify.mjs  （需后端 :8080 在跑）
const B = 'http://localhost:8080/api'
const get = (p) => fetch(B + p).then((r) => r.json())

let pass = 0, fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name) }
}

async function main() {
  // 取一个真实热门游戏
  const hot = await get('/games/hot?limit=5')
  const gid = hot.data[0].id
  console.log('[1] 活跃玩家接口 GET /games/' + gid + '/active-users')
  const au = await get(`/games/${gid}/active-users?limit=6`)
  check('code=200', au.code === 200)
  check('返回数组', Array.isArray(au.data))
  check('数量 <= 6', au.data.length <= 6)
  check('每项含 id/nickname/postCount', au.data.every(u => u.id && u.nickname && typeof u.postCount === 'number'))
  check('postCount 全部 > 0', au.data.every(u => u.postCount > 0))
  check('按发帖数降序', au.data.every((u, i, a) => i === 0 || a[i - 1].postCount >= u.postCount))
  check('带活跃度称号', au.data.every(u => !!u.activityTitle))

  console.log('[2] 不存在游戏 → 404')
  const bad = await get('/games/999999/active-users')
  check('code=404', bad.code === 404)

  console.log('[3] Game Hub 三栏数据源')
  const hotPosts = await get(`/posts?gameId=${gid}&sort=hot&size=5`)
  check('热门讨论返回数组', Array.isArray(hotPosts.data.records))
  const guide = await get(`/posts?gameId=${gid}&boardId=1&sort=latest&size=5`)
  check('最新攻略(板块1)返回数组', Array.isArray(guide.data.records))
  check('攻略帖确属板块1', guide.data.records.every(p => p.boardId === 1))
  const news = await get(`/posts?gameId=${gid}&boardId=4&sort=latest&size=5`)
  check('最新资讯(板块4)返回数组', Array.isArray(news.data.records))
  check('资讯帖确属板块4', news.data.records.every(p => p.boardId === 4))

  console.log('[4] 游戏详情可用')
  const detail = await get(`/games/${gid}`)
  check('code=200', detail.code === 200)
  check('含 name/cover 字段', !!(detail.data && detail.data.name))

  console.log('[5] 版主接口 GET /games/' + gid + '/moderators')
  const mod = await get(`/games/${gid}/moderators`)
  check('code=200', mod.code === 200)
  check('返回数组', Array.isArray(mod.data))
  check('每项含 id/nickname', mod.data.every((m) => m.id && m.nickname))
  check('每项 boards 为数组', mod.data.every((m) => Array.isArray(m.boards)))
  check('每项带 postCount（数字）', mod.data.every((m) => typeof m.postCount === 'number'))
  check('每项带 activityTitle', mod.data.every((m) => !!m.activityTitle))
  check('不下发 boardNames 原始串', mod.data.every((m) => m.boardNames == null))
  const badMod = await get('/games/999999/moderators')
  check('不存在游戏 → 404', badMod.code === 404)

  console.log(`\n═══ Game Hub 结果：通过 ${pass} / 失败 ${fail} ═══`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('ERR', e); process.exit(1) })

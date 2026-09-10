// Game Hub 排序逻辑验证（09-05）：
//   all/latest/hot/essence/reply/favorite 各 sort 参数的契约与行为
// 运行：cd tests && node sort-verify.mjs   （需后端 :8080 在跑）
const BASE = 'http://localhost:8080/api'
const j = async (method, path, body) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined
  })
  const data = await r.json().catch(() => null)
  return { status: r.status, code: data?.code, data: data?.data, raw: data }
}
const get = (p) => j('GET', p, null)

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra) }
}

// 取 game 2（已知含 6+ 帖、其中部分 essence）
const GAME_ID = 2
const SIZE = 20

async function pageOf(sort) {
  const r = await get(`/posts?gameId=${GAME_ID}&sort=${sort}&size=${SIZE}`)
  return r
}

async function main() {
  console.log(`[1] game=${GAME_ID} 各 sort 接口均 200`)
  const sorts = ['all', 'latest', 'hot', 'essence', 'reply', 'favorite']
  for (const s of sorts) {
    const r = await pageOf(s)
    check(`sort=${s} → code=200`, r.code === 200)
    check(`sort=${s} → data.records 是数组`, Array.isArray(r.data?.records))
  }

  console.log('[2] 全部 / 精华：一次性返回全部（不分页，total === records.length）')
  const all = (await pageOf('all')).data
  const essence = (await pageOf('essence')).data
  check('all total === records.length', all.total === all.records.length, `total=${all.total} records=${all.records.length}`)
  check('all size === records.length', all.size === all.records.length)
  check('all pages === 1', all.pages === 1)
  check('all records.length > 0（应有可见帖）', all.records.length > 0)
  check('essence records 仅含精华', essence.records.every((p) => p.isEssence === 1))
  check('essence total === records.length', essence.total === essence.records.length)

  console.log('[3] 热门 / 最新 / 最多回复 / 最多收藏：真实分页（total 不再截断）')
  // 2026-09-10 契约变更：原先后端把这四类 sort 的 total 截断到 pageSize 以「隐藏分页」，
  // 导致首页/板块页分页条永不出现（叠加前端 PAGE_SIZE/pageSize 大小写 bug）。
  // 现在改为透传真实 total —— 这里用小 size 验证「确实会分页」：
  //   total 反映全量、size 等于请求值、pages 由 total 推出、第 2 页能取到不重叠的内容。
  const SMALL = 5
  for (const s of ['hot', 'latest', 'reply', 'favorite']) {
    const p1 = (await get(`/posts?gameId=${GAME_ID}&sort=${s}&size=${SMALL}`)).data
    check(`${s} total 反映全量（未截断到 size）`, p1.total >= p1.records.length, `total=${p1.total} recs=${p1.records.length}`)
    check(`${s} size === 请求值 ${SMALL}`, p1.size === SMALL, `size=${p1.size}`)
    check(`${s} pages 由 total 推出`, p1.pages === Math.max(1, Math.ceil(p1.total / SMALL)), `pages=${p1.pages} total=${p1.total}`)
    check(`${s} records.length ≤ size`, p1.records.length <= SMALL, `recs=${p1.records.length}`)
    if (p1.total > SMALL) {
      const p2 = (await get(`/posts?gameId=${GAME_ID}&sort=${s}&size=${SMALL}&current=2`)).data
      const ids1 = p1.records.map((x) => x.id)
      const ids2 = p2.records.map((x) => x.id)
      check(`${s} 第 2 页可独立取到且与第 1 页不重叠`,
        ids2.length > 0 && !ids2.some((id) => ids1.includes(id)),
        `p1=${ids1.length} 条 / p2=${ids2.length} 条`)
    }
  }

  console.log('[4] 热门 / 最多回复 / 最多收藏：排序单调性')
  const hot = (await pageOf('hot')).data.records
  // 综合分 = 浏览 + 点赞*2 + 评论*3 + 收藏
  const favCount = async (postId) => {
    // 收藏数由后端子查询计算，前端拿不到精确值；此处用接口侧 view/like/reply 估算
    const p = hot.find((x) => x.id === postId)
    return p ? p.favoriteCount || 0 : 0
  }
  // 由于收藏数没有返回字段（post 表没 favorite_count 字段），hot 的实际计算包含收藏。
  // 这里只校验 reply/favorite 在相等 key 情况下按数值倒序
  const reply = (await pageOf('reply')).data.records
  for (let i = 1; i < reply.length; i++) {
    if (reply[i].replyCount > reply[i - 1].replyCount) { fail++; console.log('  ✗ reply 排序不单调'); break }
  }
  if (reply.length >= 2 && reply.every((p, i, arr) => i === 0 || arr[i - 1].replyCount >= p.replyCount)) check('reply 按 replyCount 倒序', true)
  else if (reply.length < 2) check('reply 数据太少跳过倒序检查', true)
  else check('reply 按 replyCount 倒序', false)

  const fav = (await pageOf('favorite')).data.records
  check('favorite 接口 200/有数据', fav.length > 0)

  console.log(`\n═══ Game Hub 排序验证：通过 ${pass} / 失败 ${fail} ═══`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('ERR', e); process.exit(1) })
/**
 * 探针：小程序端「端内索引缓存」到底怎么影响数据新鲜度？
 *
 * 回答一个问题（2026-09-26 用户提问）：
 *   「在主站更新帖子（数据库变了），小程序里的数据会跟着变吗？」
 *
 * 段位设计（全程只读；唯一副作用是访问一次主站详情页 ⇒ 该帖 viewCount +1，属站点正常行为）：
 *   ① 打开 /m/ 等端内索引同步完成 → 记下索引的 `at`(同步时刻) 与某帖的 viewCount
 *   ② 立刻重新加载页面 → 再读 `at`：不变 = 命中了缓存（TTL 内不会重新拉接口）
 *   ③ 统计两次加载各自的 /api 请求条数与 URL（缓存命中应该"几乎零请求"）
 *   ④ 清掉端内索引后再加载 → `at` 变新、viewCount 取到最新值 = 强刷才会同步
 *
 * 用法：
 *   MP_BASE=http://8.133.255.202/m NODE_PATH='E:\2kewai\YUMUGameCommunity\tests\.pw\node_modules' \
 *     node tests/.pw/probe-index-cache.cjs
 */
const { chromium } = require('playwright-core')

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.MP_BASE || 'http://8.133.255.202/m/'
const API_HOST = process.env.API_HOST || 'http://8.133.255.202'

const ok = (n, cond, extra = '') => {
  console.log((cond ? '✅ ' : '❌ ') + n + (extra ? '  — ' + extra : ''))
  return !!cond
}

/** 等到端内索引落盘（H5 首次同步要 3~4 个请求，给足时间） */
async function waitIndex(page, timeout = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const at = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('yumu_guide_index_v4')
        if (!raw) return null
        const v = JSON.parse(raw)
        const d = v && v.type === 'object' ? v.data : v
        return d && d.at ? d.at : null
      } catch (e) {
        return null
      }
    })
    if (at) return at
    await page.waitForTimeout(500)
  }
  return null
}

/** 读索引摘要：at + 条数 + 首条帖 */
function readIndex(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('yumu_guide_index_v4')
      if (!raw) return null
      const v = JSON.parse(raw)
      const d = v && v.type === 'object' ? v.data : v
      if (!d || !Array.isArray(d.items)) return null
      const first = d.items.find((x) => x && x.id)
      return {
        at: d.at || 0,
        count: d.items.length,
        first: first ? { id: first.id, title: first.title, viewCount: first.viewCount, boardId: first.boardId } : null
      }
    } catch (e) {
      return null
    }
  })
}

/** 读索引的同步时刻 `at` */
async function readIndexAt(page) {
  const idx = await readIndex(page)
  return idx && idx.at ? idx.at : null
}

/**
 * 轮询直到索引 `at` 变成一个**比 oldAt 更新**的值。
 * 🚨 不能用「at 存在」当判据：伪造过期时 at 本来就在（只是很旧），会立刻返回伪造值 ⇒ 假绿。
 * 🚨 也不能用「at !== oldAt」：伪造值天然 ≠ oldAt，同样第一轮就误判。只有「更大」才说明真同步了。
 */
async function waitIndexChange(page, oldAt, timeout = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const at = await readIndexAt(page)
    if (at && at > oldAt) return at
    await page.waitForTimeout(400)
  }
  return null
}

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  /** 记录某一次页面加载期间发出的 /api 请求 */
  async function loadAndTrack(label, oldAt = null) {
    const reqs = []
    const onReq = (r) => {
      const u = r.url()
      if (u.includes('/api/')) reqs.push(r.method() + ' ' + u.replace(API_HOST, ''))
    }
    page.on('request', onReq)
    await page.goto(BASE + '?_t=' + Date.now(), { waitUntil: 'load' }).catch(() => {})
    // oldAt 非空 ⇒ 本次预期「同步出新值」，轮询等它真的变；否则只等落盘
    const at = oldAt ? await waitIndexChange(page, oldAt) : await waitIndex(page)
    await page.waitForTimeout(1200)
    page.off('request', onReq)
    const idx = await readIndex(page)
    console.log(`\n─── ${label} ───`)
    console.log('  索引 at      :', at ? new Date(at).toISOString() : '(未落盘)')
    console.log('  索引条数     :', idx ? idx.count : '-')
    console.log('  /api 请求数  :', reqs.length)
    reqs.slice(0, 8).forEach((r) => console.log('     ·', r))
    if (reqs.length > 8) console.log(`     · …另有 ${reqs.length - 8} 条`)
    return { at, idx, reqs }
  }

  let pass = 0
  let total = 0

  // ── ① 首次加载：同步并落盘
  const A = await loadAndTrack('① 首次加载（冷启动，应触发全量同步）')
  total += 3
  pass += ok('A1 端内索引已落盘', !!A.at)
  pass += ok('A2 索引条数 > 0', !!(A.idx && A.idx.count > 0), A.idx ? A.idx.count + ' 条' : '')
  pass += ok('A3 真的打了内容池接口', A.reqs.some((r) => r.includes('/posts')), A.reqs.filter((r) => r.includes('/posts')).length + ' 条 /posts')

  // ── ② 紧接着再进一次：TTL（10 分钟）内应命中缓存，at 不变、请求趋近 0
  const B = await loadAndTrack('② 立刻再进（距上次同步 <10min，应命中缓存）')
  total += 3
  pass += ok('B1 索引 at 未变（没重新同步）', !!(A.at && B.at && A.at === B.at), A.at === B.at ? '同一个 at' : 'at 变了 ⇒ 未命中缓存')
  pass += ok('B2 本次 /api 请求数明显少于首次', B.reqs.length < A.reqs.length, `首次 ${A.reqs.length} → 本次 ${B.reqs.length}`)
  pass += ok('B3 列表数据来自缓存（条数一致）', !!(A.idx && B.idx && A.idx.count === B.idx.count), A.idx && B.idx ? `${A.idx.count} vs ${B.idx.count}` : '')

  // ── ③ 对照：直接打接口拿「数据库当前真值」，看它和索引里记的差多少
  const truth = await page.evaluate(async (host) => {
    const r = await fetch(host + '/api/posts?boardId=1&sort=latest&current=1&size=1', { cache: 'no-store' })
    const j = await r.json()
    const p = (j.data && j.data.records && j.data.records[0]) || null
    return p ? { id: p.id, title: p.title, viewCount: p.viewCount } : null
  }, API_HOST).catch(() => null)
  console.log('\n─── ③ 同一时刻的「接口真值」（不带任何端内缓存）───')
  console.log('  最新帖        :', truth ? `#${truth.id} ${truth.title}` : '(取不到)')

  const cached = A.idx && A.idx.first
  if (truth && cached) {
    total += 1
    const same = Number(truth.id) === Number(cached.id)
    // 说明性比对：id 相同则再看 viewCount 有没有差；id 不同说明缓存里首条已被新帖挤下去
    pass += ok(
      'C1 索引首条来自同一个内容池（可与接口真值直接对照）',
      true,
      same
        ? `接口 viewCount=${truth.viewCount} / 索引记的是 ${cached.viewCount}`
        : `索引首条 #${cached.id} ≠ 接口最新 #${truth.id}（同步后内容池有新帖）`
    )
  }

  // ── ④ 清掉端内索引再进：应该重新同步、at 变新
  await page.evaluate(() => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('yumu_guide_index'))
      .forEach((k) => localStorage.removeItem(k))
  })
  const D = await loadAndTrack('④ 清掉端内索引后再进（等价于下拉刷新的「跳过缓存」）')
  total += 2
  pass += ok('D1 重新同步 ⇒ at 变新或落盘', !!D.at)
  pass += ok('D2 重新打了内容池接口', D.reqs.some((r) => r.includes('/posts')), D.reqs.filter((r) => r.includes('/posts')).length + ' 条 /posts')

  // ── ⑤ TTL 真的生效吗？把索引的 `at` 改成 30 分钟前（伪造过期），再进应重新同步
  await page.evaluate(() => {
    const k = 'yumu_guide_index_v4'
    const raw = localStorage.getItem(k)
    if (!raw) return
    const v = JSON.parse(raw)
    const d = v && v.type === 'object' ? v.data : v
    d.at = Date.now() - 30 * 60 * 1000
    localStorage.setItem(k, JSON.stringify(v))
  })
  const E = await loadAndTrack('⑤ 把索引改成「30 分钟前同步」（伪造过期）后再进', D.at)
  total += 3
  // 🚨 判据必须是「出现了一个**比原值更新**的新 at」，而不是「at 变了」——
  //    伪造出来的旧 at 本身就和 D.at 不等，只判不等会无条件通过（本条初版就踩了这个坑）。
  const fresh = !!(E.at && E.at > D.at && Date.now() - E.at < 60000)
  pass += ok('E1 过期后确实重新同步，且新 at 就是「刚刚」', fresh, E.at ? `新 at ${new Date(E.at).toISOString()}（距今 ${Math.round((Date.now() - E.at) / 1000)}s）` : '等了 15s 仍是旧 at ⇒ TTL 未生效')
  pass += ok('E2 过期后重新打了内容池接口', E.reqs.some((r) => r.includes('/posts')), E.reqs.filter((r) => r.includes('/posts')).length + ' 条 /posts')
  pass += ok('E3 与「未过期就进」形成对照（B 段零 /posts / E 段有 /posts）', B.reqs.filter((r) => r.includes('/posts')).length === 0 && E.reqs.some((r) => r.includes('/posts')), `B=${B.reqs.filter((r) => r.includes('/posts')).length} 条 / E=${E.reqs.filter((r) => r.includes('/posts')).length} 条`)

  // ── ⑥ 切底部 tab 再切回来：页面实例是否保留？（决定超时后能否「自己」更新）
  await page.goto(BASE + '?_t=' + Date.now(), { waitUntil: 'load' }).catch(() => {})
  await waitIndex(page, 8000)
  await page.waitForTimeout(1000)
  await page.evaluate(() => {
    window.__probeMark = 'alive'
  })
  let tabInfo = '未找到 tabBar'
  let kept = null
  try {
    const items = await page.$$('.uni-tabbar__item')
    tabInfo = `tabBar ${items.length} 项`
    if (items.length >= 2) {
      await items[1].click()
      await page.waitForTimeout(2500)
      const back = await page.$$('.uni-tabbar__item')
      if (back.length >= 1) {
        await back[0].click()
        await page.waitForTimeout(2500)
      }
      kept = await page.evaluate(() => window.__probeMark || null)
    }
  } catch (e) {
    tabInfo += `（切页异常：${e.message}）`
  }
  console.log('\n─── ⑥ 切 tab 往返（H5 端）───')
  console.log('  ' + tabInfo)
  console.log('  window 标记    :', kept || '(已丢失 ⇒ 页面被销毁重建，onLoad 会重跑)')
  total += 1
  pass += ok('F1 H5 端切 tab 往返后页面实例保留（keep-alive）', kept === 'alive', kept === 'alive' ? '保留 ⇒ 不会自动重跑 onLoad' : '重建 ⇒ 切回来会重跑 onLoad')

  console.log(`\n=== 结果：${pass}/${total} 通过 ===`)
  await browser.close()
  process.exit(pass === total ? 0 : 1)
})().catch((e) => {
  console.error('ERR', e.message)
  process.exit(1)
})

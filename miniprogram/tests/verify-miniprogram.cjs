/**
 * 小程序 H5 端浏览器回归（打在**真实构建产物**上，不是 dev server）。
 *
 * 前置：
 *   1) cd miniprogram && npm run build:h5
 *   2) node tests/serve-h5.mjs          # 起在 http://localhost:5199/m/
 *      · 打本地后端：API_TARGET=http://127.0.0.1:8080 node tests/serve-h5.mjs
 *   3) NODE_PATH="<repo>/tests/.pw/node_modules" node tests/verify-miniprogram.cjs
 *
 * 可选环境变量：MP_BASE（默认 http://localhost:5199/m）、CHROME（Chrome 路径）
 *   打线上：MP_BASE=http://8.133.255.202/m  —— 发版后的线上验收就靠它。
 *
 * ── 2026-09-17 定位调整（社区消费端 → 多平台攻略聚合展示端）后的回归重点 ──────
 *  ① **平台筛选的数字必须与筛出来的条数一致**：两者都由端内索引算出，
 *     但断言**不能只对页面自身**（那样等于自证）。这里改成先在浏览器里独立
 *     打接口把「每个平台到底有几篇」算一遍，再对按钮上的数字与渲染出的卡片角标。
 *  ② **回复区已按产品口径移除**：断言详情页不再出现任何回复元素，
 *     且「相关攻略」接住了原本在页面底部的位置（读完有下一条，而不是只有返回）。
 *  ③ **H5 宽屏**：主交付渠道是 H5，1440px 下内容栏必须有宽度上限（原来被拉到 1412px）。
 *  ④ 沿用既有的「故障 ≠ 空数据」纪律：断网时必须出失败态 + 重试，不能说成「没有内容」。
 *  ⑤ **R 组（2026-09-20 新增）**：主动制造「静默空响应 / 历史坏缓存」这两种事故环境，
 *     验证平台分类不再被一份空数据锁死（详见文件末尾 R 段注释）。
 *  ⑥ **类型改为「搜索即达」（2026-09-20 二次调整）**：游戏库去掉类型「二次分类」筛选行，
 *     标签改为通过搜索框输入命中（请求带 `genre=` 精确筛选）；底部导航互换为
 *     攻略 → 资讯 → 游戏库 → 我的。
 *  ⑦ **搜索页统一口径（2026-09-21）**：搜索页的「游戏」一路从 `/search?type=game`
 *     换成 `/games`（前者内部 `LIMIT 8`、无分页无总数，且把 `publisher` 也当匹配字段
 *     —— 「搜『资讯』搜出《仙剑奇侠传》」就是它把发行商「大宇**资讯**」匹配上了）。
 *     现在关键词先由端内解析成类型 / 平台**精确值**（`utils/keywordFilter.js`，
 *     与游戏库页共用），再把命中原因回显到卡片上。F5-F15 锁这些行为。
 *  ⑧ **内容按板块硬切：攻略页 board1 / 资讯页 board4（2026-09-21 二次调整）**：
 *     上一版是「按发帖账号分流」（官方帖只进资讯页），但首页当时仍聚合两个板块，
 *     于是「攻略」里照样能看到资讯速递的玩家投稿 —— 用户截图反馈「攻略和资讯混在一起」。
 *     现在改为**按板块硬切、两页零重叠**：
 *       · 首页「攻略」页 = 攻略心得(board 1) 全部帖；
 *       · 底部「资讯」页 = 资讯速递(board 4) 全部帖（官方公告 + 玩家投稿）。
 *     官方帖改靠 **落库的 `is_top=1` / `is_essence=1`** + 「官方」角标凸显，不再独占页面。
 *     `truth` 现在独立算出三套事实：攻略池(board1) / 资讯池(board4) / 官方帖数。
 *
 *     🚨 **同一次改造里挖出的真 bug**：游戏详情页的「攻略 / 资讯」两个 Tab 拿到的是
 *     **完全相同的列表**。根因不在前端 —— 小程序一直在传 `/games/{id}/posts?boardId=1|4`，
 *     但后端 `GameController#posts` **根本没有 `boardId` 参数**，Spring 静默丢弃未知查询参数。
 *     F 组断言专门锁这个回归（它必须靠**接口按板块过滤后的真值**来判，页面自证是抓不到的）。
 *     —— 组号实为 **T 组**（`F` 已被「搜索链路」那组占用，见 T 组处的说明）。
 */
const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright-core')

const EXE = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.MP_BASE || 'http://localhost:5199/m'
const SHOTS = path.join(__dirname, 'shots')
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true })

let pass = 0
let fail = 0
function assert(name, cond, extra = '') {
  const ok = !!cond
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  [' + extra + ']' : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 展示名 → 后端 `game.platform` 取值（库里存「手机」，界面写「手游」） */
const LABEL_TO_VALUE = { 手游: '手机', 多平台: '多平台', PC: 'PC', 主机: '主机' }

/**
 * 官方资讯账号的 user.id —— **必须与 `src/api/config.js#OFFICIAL_UID` 保持一致**。
 * 这里硬编码是故意的：测试要能独立于被测代码算出「哪些是官方帖」，
 * 若从被测模块 import，被测代码改错了测试也跟着错，等于自证。
 * 改账号时两处一起改。
 */
const OFFICIAL_UID = 20142

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  })
  const page = await ctx.newPage()

  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE-ERR ' + m.text())
  })

  // 全程收集图片请求，最后统一断言（覆盖首页 / 游戏库 / 资讯 / 详情各页）
  const fileReqs = []
  page.on('response', (r) => {
    const u = r.url()
    if (u.includes('/api/files/')) {
      fileReqs.push({ url: u, status: r.status(), ct: r.headers()['content-type'] || '' })
    }
  })

  // 全程收集请求 URL：R0 用它扫「query 里有没有 undefined 串」（2026-09-20 事故入口）
  const allReqUrls = new Set()
  page.on('request', (r) => allReqUrls.add(r.url()))

  const count = async (sel) => page.$$eval(sel, (els) => els.length)
  const text = async (sel) => ((await page.$(sel)) ? await page.$eval(sel, (el) => el.innerText) : '')
  const goto = async (hash) => {
    // 🚨 必须带一个变化的 query 强制**整页重载**：
    //    只改 hash 的话浏览器不会重新加载文档，SPA 会带着上一节的状态（筛选/滚动位置）继续跑。
    await page.goto(`${BASE}/?t=${Date.now()}#${hash}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(2800)
  }
  /** 轮询等待元素出现（端内索引是一次全量同步，首屏比普通页面慢一点） */
  async function waitFor(sel, timeout = 12000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if ((await count(sel)) > 0) return true
      await sleep(300)
    }
    return false
  }

  /* ========== 先在浏览器里**独立**把「每个平台有几篇」算出来 ==========
     用途：给下面的平台按钮数字与卡片角标做交叉核对。
     故意不复用页面逻辑（页面用的是端内索引），这是一条独立路径 ——
     如果哪天索引归类写错了（比如拿「手游」去比 platform），这里会直接报红。
  */
  console.log('\n--- 准备：独立计算各平台的真实篇数 ---')
  await goto('/pages/index/index')
  const truth = await page.evaluate(async (OFFICIAL_UID) => {
    const api = async (u) => {
      try {
        const r = await fetch('/api' + u).then((x) => x.json())
        return r && r.data
      } catch (e) {
        return null
      }
    }
    // ① 全部游戏 → gameId → platform
    const games = []
    for (let c = 1; c <= 3; c++) {
      const d = await api(`/games?current=${c}&size=100`)
      const rec = (d && d.records) || []
      games.push(...rec)
      if (!rec.length || games.length >= (d.total || 0)) break
    }
    const gm = {}
    games.forEach((g) => {
      gm[g.id] = g.platform || ''
    })
    /** 类型（genre）分布：给 C 组的「搜索类型名」断言挑一个真实存在的类型（独立于页面自证） */
    const genreCounts = {}
    games.forEach((g) => {
      const k = String(g.genre || '').trim()
      if (k) genreCounts[k] = (genreCounts[k] || 0) + 1
    })
    // ② 两个板块各自拉全 —— 2026-09-21 起页面**按板块硬切**，所以这里必须按板块分别算真值：
    //   · counts / total = 「攻略池」= 攻略心得(board 1) 全部（A 组断言对的是它）；
    //   · news           = 「资讯池」= 资讯速递(board 4) 全部（D 组断言对的是它）；
    //   · official       = 资讯池里由官方账号发布的条数（角标 / 置顶断言用）。
    const counts = { '': 0, 多平台: 0, PC: 0, 主机: 0, 手机: 0 }
    /** 每个板块各自的篇数：攻略页(A) 与资讯页(D) 的口径差异就靠它核对 */
    const byBoard = {}
    const boardRecs = {}
    let official = 0
    let homeTotal = 0
    for (const b of [1, 4]) {
      const got = []
      for (let c = 1; c <= 3; c++) {
        const d = await api(`/posts?boardId=${b}&sort=latest&current=${c}&size=100`)
        const rec = (d && d.records) || []
        got.push(...rec)
        if (!rec.length || got.length >= (d.total || 0)) break
      }
      byBoard[b] = got.length
      boardRecs[b] = got
      if (b === 4) {
        // Number() 归一化：接口返回数字，但端内索引经存储往返可能是字符串
        official = got.filter((p) => Number(p.userId) === OFFICIAL_UID).length
      } else {
        homeTotal = got.length
        got.forEach((p) => {
          const k = gm[p.gameId]
          if (k) counts[k] = (counts[k] || 0) + 1
        })
      }
    }
    counts[''] = homeTotal

    // ③ 挑一款**两个板块都有帖**的游戏，供 F 组验证游戏详情页的两个 Tab 真的分了板块。
    //    两边的期望值都取 `/games/{id}/posts?boardId=X` 的接口真值 ——
    //    这个接口过去会忽略 boardId（F 组就是为它加的），所以必须独立取数。
    let detail = null
    const b1Games = new Set((boardRecs[1] || []).map((p) => p.gameId))
    for (const p of boardRecs[4] || []) {
      if (!b1Games.has(p.gameId)) continue
      const g1 = await api(`/games/${p.gameId}/posts?boardId=1&sort=latest&current=1&size=100`)
      const g4 = await api(`/games/${p.gameId}/posts?boardId=4&sort=latest&current=1&size=100`)
      detail = {
        id: Number(p.gameId),
        b1: ((g1 && g1.records) || []).map((x) => String(x.title || '').trim()),
        b4: ((g4 && g4.records) || []).map((x) => String(x.title || '').trim())
      }
      break
    }

    // ④ 再挑一款官方帖所在的游戏，用来验证「官方 / 置顶 / 精华」三重标识。
    //    优先挑「board1 一篇都没有」的 —— 那正是用户截图里的场景
    //    （三角洲行动：攻略 Tab 空态、资讯 Tab 全是官方公告）。
    //    ⚠️ 不打这个偏好也没关系：F 组会按 b1Total 自适应断言，不会误报。
    let officialGame = null
    const offRecs = (boardRecs[4] || []).filter((p) => Number(p.userId) === OFFICIAL_UID)
    const triedG = new Set()
    for (const pass of [0, 1]) {
      for (const p of offRecs) {
        if (triedG.has(p.gameId)) continue
        triedG.add(p.gameId)
        const c1 = await api(`/games/${p.gameId}/posts?boardId=1&sort=latest&current=1&size=1`)
        const b1Total = (c1 && c1.total) || 0
        if (pass === 0 && b1Total !== 0) continue
        officialGame = {
          id: Number(p.gameId),
          b1Total,
          officialCount: offRecs.filter((x) => x.gameId === p.gameId).length
        }
        break
      }
      if (officialGame) break
    }

    return {
      counts,
      total: homeTotal,
      news: byBoard[4],
      official,
      byBoard,
      detail,
      officialGame,
      games: games.length,
      genres: genreCounts
    }
  }, OFFICIAL_UID)
  assert(
    'P0 独立算出两板块规模（攻略 board1 / 资讯 board4）',
    truth.total >= 100 && truth.games >= 50 && truth.news > 0 && truth.official > 0,
    `攻略池=${truth.total} 资讯池=${truth.news} 官方帖=${truth.official} 游戏=${truth.games}`
      + ` 分布=${JSON.stringify(truth.counts)} 板块=${JSON.stringify(truth.byBoard)}`
  )
  assert(
    'P0b 内容池按板块互斥（攻略 board1 与资讯 board4 各自独立）',
    truth.byBoard[1] > 0 && truth.byBoard[4] > 0 && truth.total === truth.byBoard[1],
    `board1=${truth.byBoard[1]} board4=${truth.byBoard[4]} 攻略池=${truth.total}`
  )

  /* ================= A. 首页 = 攻略聚合页 ================= */
  console.log('\n--- A. 首页（平台筛选是核心交互）---')
  assert('A1 搜索入口渲染', (await count('.search')) >= 1)
  assert('A2 定位横幅渲染（多平台攻略库）', (await page.content()).includes('多平台游戏攻略库'))
  assert('A3 统计条 3 项', (await count('.hero__stat')) === 3)

  // 端内索引是一次全量同步（254 帖），先等首屏卡片出来再读按钮上的数字，
  // 否则会读到还没填数的「0」——那是**测试抢跑**，不是功能坏了
  if (!(await waitFor('.pc', 15000))) console.log('   ⚠️ 等首屏卡片超时，下面按钮数字可能读到 0')
  const tabTexts = await page.$$eval('.pf__btn', (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, ' ').trim())
  )
  assert('A4 平台筛选按钮 5 档', tabTexts.length === 5, tabTexts.join(' | '))
  assert('A5 平台按钮顺序正确', /^全部/.test(tabTexts[0] || '') && /^手游/.test(tabTexts[4] || ''), tabTexts.join(' | '))

  // A6 每个按钮上的数字 = 独立算出来的真实篇数（**本次改版最核心的一条断言**）
  const pageCounts = {}
  tabTexts.forEach((t) => {
    const m = t.match(/^(\S+)\s*(\d+)?$/)
    if (m) pageCounts[m[1]] = m[2] === undefined ? undefined : Number(m[2])
  })
  const badCount = []
  Object.keys(LABEL_TO_VALUE).forEach((label) => {
    const val = LABEL_TO_VALUE[label]
    if (pageCounts[label] !== truth.counts[val]) {
      badCount.push(`${label}: 页面=${pageCounts[label]} 接口=${truth.counts[val]}`)
    }
  })
  assert('A6 各平台按钮数字 = 接口独立统计', badCount.length === 0, badCount.join('；') || JSON.stringify(pageCounts))
  assert('A7 「全部」数字 = 干货池总量', pageCounts['全部'] === truth.total, `页面=${pageCounts['全部']} 接口=${truth.total}`)
  // A7b：每一篇都必须有平台归属（各档之和 = 全部）。事故态下四档全是 0、只剩「全部 254」，
  //      这条会立刻报红；同时也防「平台映射漏了一批 gameId」这种半坏的情况。
  const platSum = Object.keys(LABEL_TO_VALUE).reduce((n, label) => n + (pageCounts[label] || 0), 0)
  assert(
    'A7b 各平台篇数之和 = 干货池总量（无「平台未知」的漏网帖子）',
    platSum === truth.total,
    `和=${platSum} 全部=${truth.total}`
  )

  assert('A8 首屏渲染帖子卡', (await count('.pc')) >= 8, `pc=${await count('.pc')}`)
  assert('A9 首屏卡片带平台角标', (await count('.pc__plat')) >= 8, `plat=${await count('.pc__plat')}`)
  assert('A10 结果计数与「全部」一致', (await text('.bar__count')).includes(String(truth.total)), await text('.bar__count'))
  // A10b 板块硬切（2026-09-21 二次调整）：本页现在**只放攻略心得(board 1)**，
  //     官方帖发在 board 4 ⇒ 首页一篇都不该有。判据取卡片上的「官方」标签 ——
  //     它按账号 uid 渲染，绕不过去。
  //     「条数恰好等于 board1」已由 A7/A10 锁住（它们对的是 truth.total = board1 真值），
  //     这条补的是**反向证据**：资讯侧的内容没漏进来。
  //     ⚠️ 编号用 A10b 而不是 A11 —— A11..A16 已被下面的平台/公告断言占用，
  //        直接叫 A11 会重名（插在中间又不想把后面全部重编号）。
  const homeOfficial = await count('.pc__badge--official')
  assert(
    'A10b 首页不含官方资讯帖（官方帖全部归资讯页）',
    truth.official > 0 && homeOfficial === 0,
    `首页官方标签=${homeOfficial} 接口官方帖=${truth.official}`
  )
  await page.screenshot({ path: path.join(SHOTS, 'A-home.png') })

  /* ---------- A-plat. 切换平台：数字、卡片角标、条数三者必须自洽 ---------- */
  console.log('\n--- A-plat. 切平台后卡片必须真的换了 ---')
  const chips = await page.$$('.pf__btn')
  let consoleChip = null
  for (const ch of chips) {
    if ((await ch.innerText()).replace(/\s+/g, '').startsWith('主机')) consoleChip = ch
  }
  if (consoleChip) {
    await consoleChip.click()
    await sleep(900)
    const labels = await page.$$eval('.pc__plat', (els) => els.map((e) => e.innerText.trim()))
    const wrong = labels.filter((x) => x !== '主机')
    assert('A11 选「主机」后卡片角标全部为主机', labels.length > 0 && wrong.length === 0, `角标=${labels.length} 异常=${wrong.length}`)
    const cnt = await text('.bar__count')
    assert('A12 结果计数 = 主机真实篇数', cnt.includes(String(truth.counts['主机'])), `页面「${cnt}」 期望 ${truth.counts['主机']}`)
    await page.screenshot({ path: path.join(SHOTS, 'A-plat-console.png') })
  } else {
    assert('A11 找到「主机」按钮', false)
    assert('A12 结果计数 = 主机真实篇数', false)
  }

  // A13 切到「手游」：验证「展示名 手游 ↔ 取值 手机」这层映射没写反
  const chips2 = await page.$$('.pf__btn')
  let mobileChip = null
  for (const ch of chips2) {
    if ((await ch.innerText()).replace(/\s+/g, '').startsWith('手游')) mobileChip = ch
  }
  if (mobileChip) {
    await mobileChip.click()
    await sleep(900)
    const cnt2 = await text('.bar__count')
    const labels2 = await page.$$eval('.pc__plat', (els) => els.map((e) => e.innerText.trim()))
    assert(
      'A13 选「手游」计数与角标都对（映射未写反）',
      cnt2.includes(String(truth.counts['手机'])) && labels2.length > 0 && labels2.every((x) => x === '手游'),
      `页面「${cnt2}」 期望 ${truth.counts['手机']} 角标=${labels2[0]}`
    )
  } else {
    assert('A13 选「手游」计数与角标都对（映射未写反）', false, '未找到手游按钮')
  }

  /* ---------- A-notice. 公告可点开（原来只渲染标题且不可点） ---------- */
  console.log('\n--- A-notice. 公告可点开 ---')
  await goto('/pages/index/index')
  if ((await count('.notice')) >= 1) {
    await page.click('.notice')
    await sleep(700)
    assert('A14 点公告弹出正文浮层', (await count('.sheet')) >= 1, `sheet=${await count('.sheet')}`)
    const sheetTxt = await text('.sheet__panel')
    assert('A15 浮层里有正文（不只是标题）', sheetTxt.replace(/\s+/g, '').length > 20, sheetTxt.replace(/\s+/g, ' ').slice(0, 40))
    if ((await count('.sheet__close')) >= 1) {
      await page.click('.sheet__close')
      await sleep(600)
      assert('A16 可关闭浮层', (await count('.sheet')) === 0)
    } else {
      assert('A16 可关闭浮层', false, '没有关闭按钮')
    }
    await page.screenshot({ path: path.join(SHOTS, 'A-notice.png') })
  } else {
    // 公告是运营数据，线上可能为空 —— 为空时不算失败，但要显式记下来
    assert('A14 线上暂无公告，跳过浮层断言', true, '公告条未渲染（无数据）')
    assert('A15 线上暂无公告，跳过浮层断言', true)
    assert('A16 线上暂无公告，跳过浮层断言', true)
  }

  /* ================= B. 详情页 · 拆解卡 ================= */
  console.log('\n--- B. 详情页（核心亮点：拆解卡）---')

  // 🚨 帖子 id 必须**动态取**：写死 id 会在换库（本地库 / 线上库 id 段不同）时整段假失败。
  //    候选只从**干货池板块**（攻略心得 boardId=1）里取，保证这个帖子在端内索引里，
  //    后面「相关攻略」才一定有内容可推。
  const candIds = await page.evaluate(async () => {
    const r = await fetch('/api/posts?boardId=1&sort=hot&current=1&size=6').then((x) => x.json())
    return ((r && r.data && r.data.records) || []).map((p) => p.id)
  })
  assert('B0 从接口取到候选帖子 id', candIds.length >= 3, candIds.join(','))

  // 🚨 B0a/B0b（2026-09-17 修「每进一帖必弹 请求方法不支持：GET」后新增）：
  //    根因是详情页曾调 `GET /posts/{id}/tags`，而后端该路径**只注册了 PUT** ⇒ 必 405。
  //    修法 = 标签改读详情返回自带的 `d.tags`。这两条断言把「不再发那个请求」与
  //    「标签真的渲染出来」都锁死 —— 只断 DOM 看不出请求消失，只断请求看不出渲染。
  const tagReqs = []
  const onTagReq = (r) => { if (/\/posts\/\d+\/tags(\?|$)/.test(r.url())) tagReqs.push(r.url()) }
  page.on('request', onTagReq)
  await goto('/pages/post/detail?id=' + candIds[0])
  await new Promise((r) => setTimeout(r, 1800))
  page.off('request', onTagReq)
  assert('B0a 详情页不再调 GET /posts/{id}/tags（后端只有 PUT，调了必 405）', tagReqs.length === 0, tagReqs.length ? tagReqs.join(',') : '未发出 tags 请求')
  const tagApiN = await page.evaluate(async (id) => {
    const d = await fetch('/api/posts/' + id).then((x) => x.json())
    return ((d && d.data && d.data.tags) || []).length
  }, candIds[0])
  const tagDomN = await count('.tags .mp-tag')
  assert('B0b 标签渲染数 = 详情接口自带的 tags 数', tagDomN === tagApiN && tagDomN > 0, `DOM=${tagDomN} 接口=${tagApiN}`)

  let hit = null
  for (const id of candIds) {
    await goto('/pages/post/detail?id=' + id)
    if ((await count('.step')) >= 2) {
      hit = { id, n: await count('.step') }
      break
    }
  }
  assert('B1 候选帖中存在可拆解内容（≥2 张要点卡）', !!hit, hit ? `id=${hit.id} step=${hit.n}` : `${candIds.length} 篇都没拆出来`)

  if (hit) {
    const modeTxt = await text('.modebar')
    assert('B2 模式条含模式标签', /要点模式|步骤模式/.test(modeTxt), modeTxt.replace(/\s+/g, ' ').slice(0, 30))
    assert('B3 详情页有正文标题', (await text('.title')).length > 4)
    assert('B4 标题区有平台角标', (await count('.pcplat')) >= 1)
    await page.screenshot({ path: path.join(SHOTS, 'B-detail-card.png') })

    // 切到原文模式
    const modeBtns = await page.$$('.modebar__btn')
    if (modeBtns.length >= 2) {
      await modeBtns[1].click()
      await sleep(600)
      const stepAfter = await count('.step')
      const pAfter = await count('.content__p')
      assert('B5 切「原文模式」后卡片消失、段落出现', stepAfter === 0 && pAfter >= 1, `step=${stepAfter} p=${pAfter}`)
      await page.screenshot({ path: path.join(SHOTS, 'B-detail-raw.png') })
      await modeBtns[0].click()
      await sleep(600)
      assert('B6 切回后卡片恢复', (await count('.step')) >= 2)
    } else {
      assert('B5 模式切换按钮存在', false)
      assert('B6 切回后卡片恢复', false)
    }

    // 操作条：点赞 / 收藏 / 分享（三个都必须能点亮或可点）
    const fabBtns = await page.$$('.fab__btn')
    assert('B7 操作条按钮数为 3（点赞 / 收藏 / 分享）', fabBtns.length === 3, `n=${fabBtns.length}`)
    const likeTxtBefore = ((await text('.fab')) || '').replace(/\s+/g, '')
    assert('B8 默认未点赞', likeTxtBefore.includes('点赞') && !likeTxtBefore.includes('已赞'), likeTxtBefore)

    await fabBtns[0].click()
    await sleep(600)
    const afterLike = ((await text('.fab')) || '').replace(/\s+/g, '')
    assert('B9 点「点赞」后点亮（本机记录）', afterLike.includes('已赞'), afterLike)

    await fabBtns[1].click()
    await sleep(600)
    const afterFav = ((await text('.fab')) || '').replace(/\s+/g, '')
    assert('B10 点「收藏」后文案变「已收藏」', afterFav.includes('已收藏'), afterFav)
    await fabBtns[1].click()
    await sleep(600)
    assert('B11 再点取消收藏', !(((await text('.fab')) || '').replace(/\s+/g, '')).includes('已收藏'))

    // B12 不能出现「功能没做完」式文案（原来点赞会弹「点赞需登录，第二期开放」）
    const fabTxt = await text('.fab')
    assert('B12 操作条不含「第二期开放 / 点赞需登录」', !/第二期|点赞需登录/.test(fabTxt), fabTxt.replace(/\s+/g, ' '))
    assert('B13 详情页渲染了作者头像或首字占位', (await count('.author__avatar')) + (await count('.author__ph')) >= 1)
  } else {
    for (const n of ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13']) {
      assert(`${n} 依赖可拆解帖子`, false, '无候选帖')
    }
  }

  // B14/B15 不存在的帖子 id：必须给失败态 + 重试，而不是永远转圈的骨架屏
  await goto('/pages/post/detail?id=999999999')
  const deadTxt = await page.content()
  assert('B14 打开不存在的帖子 → 失败态而非永久骨架屏', (await count('.err')) >= 1 && (await count('.sk')) === 0, `err=${await count('.err')}`)
  assert('B15 失败态给出了原因', /已被删除|隐藏|不存在|网络/.test(deadTxt), '')

  /* ========== B-rel. 回复区已移除 / 相关攻略接位 ==========
     定位调整：小程序改为「多平台攻略聚合展示端」，**弱化互动** ⇒ 详情页不再有回复区。
     这一节的断言方向与上一版**正好相反**（上一版在验「回复必须渲染出来」）：
       ① 页面上不能再有任何回复元素（.reply / 「💬 回复 N」）；
       ② 原本在页面底部的位置要由「相关攻略」接住 —— 否则长文读者读完只剩「返回」。
     注意别把 ① 写成「页面里不含『回复』两个字」：正文本身可能提到这两个字。
  */
  console.log('\n--- B-rel. 回复区已移除 + 相关攻略接位 ---')
  if (hit) {
    await goto(`/pages/post/detail?id=${hit.id}`)
    assert('B16 详情页没有任何回复元素', (await count('.reply')) === 0 && (await count('.reply__floor')) === 0, `reply=${await count('.reply')}`)
    assert('B17 不再出现「💬 回复 N」区块标题', !/💬\s*回复\s*\d/.test(await page.content()))
    assert('B18 操作条只有点赞/收藏/分享，无「回复」按钮', !/回复/.test(await text('.fab')), await text('.fab'))

    const hasRel = await waitFor('.mp-sec__title', 12000)
    const secTitles = await page.$$eval('.mp-sec__title', (els) => els.map((e) => e.innerText))
    assert('B19 底部由「相关攻略」接位', hasRel && secTitles.some((t) => t.includes('相关攻略')), secTitles.join(' | '))
    const relN = await count('.pc')
    assert('B20 相关攻略真的渲染出卡片', relN >= 1, `相关卡=${relN}`)
    assert('B21 相关攻略不含当前帖自己', !(await page.content()).includes(`?id=${hit.id}"`), '')
    await page.screenshot({ path: path.join(SHOTS, 'B-related.png') })
  } else {
    for (const n of ['B16', 'B17', 'B18', 'B19', 'B20', 'B21']) assert(`${n} 依赖可拆解帖子`, false, '无候选帖')
  }

  /* ========== B-card. 拆解卡不得静默丢内容 ========== */
  console.log('\n--- B-card. 拆解卡：导语 / 分组 / 不截断 ---')
  const deep = await page.evaluate(async () => {
    // ⚠️ 必须**分页**抓：后端对 size 有上限 100，而「【分组】+ 编号条目」这种结构集中在长文里
    for (let cur = 1; cur <= 4; cur++) {
      const r = await fetch(`/api/posts?boardId=1&current=${cur}&size=100`).then((x) => x.json())
      const rec = (r.data && r.data.records) || []
      for (const p of rec) {
        const plain = String(p.content || '').replace(/<[^>]+>/g, '')
        const blocks = plain.split(/\n+/).map((s) => s.trim()).filter(Boolean)
        const pureSec = blocks.filter((b) => /^【[^】]{1,24}】$/.test(b))
        const numbered = blocks.filter((b) => /^\s*\d{1,2}\s*[.、)）]/.test(b))
        if (pureSec.length >= 2 && numbered.length >= 2) {
          return { id: p.id, secs: pureSec.length, numbered: numbered.length, title: p.title }
        }
      }
      if (!rec.length) break
    }
    return null
  })
  if (deep) {
    await goto(`/pages/post/detail?id=${deep.id}`)
    const secN = await count('.sect')
    assert('B22 原文的分组标题渲染成小节（不再被丢弃）', secN >= 2, `sect=${secN} 原文分组=${deep.secs}`)
    assert('B23 导语段被保留（不再「首个序号之前直接丢弃」）', (await count('.intro')) >= 1)
    const cardN = await count('.step')
    if (deep.numbered >= 13) {
      assert('B24 卡片数突破旧上限 12（不再静默截断）', cardN >= 13, `DOM=${cardN} 原文编号条目=${deep.numbered}`)
    } else {
      assert('B24 候选帖条目不足 13，无法验证截断', true, `numbered=${deep.numbered}`)
    }
    assert('B25 未触发截断时不显示「已省略」', !(await page.content()).includes('已省略'))
    await page.screenshot({ path: path.join(SHOTS, 'B-card.png') })
  } else {
    for (const n of ['B22', 'B23', 'B24', 'B25']) assert(`${n} 依赖带分组的帖子`, false, '本次未取到候选')
  }

  /* ================= C. 游戏库 ================= */
  console.log('\n--- C. 游戏库（平台筛选 + 类型搜索）---')
  await goto('/pages/games/games')
  assert('C1 游戏列表渲染', (await count('.gitem')) >= 10, `gitem=${await count('.gitem')}`)
  assert('C2 平台筛选条 5 档', (await count('.pf__btn')) === 5)

  // 🚨 C2a-C2c（2026-09-20「分类全 0」事故新增）：这三条锁的是**数字本身是不是真的**。
  //    事故里页面把「全部 0 / 各平台 0」渲染得毫无异常（不报错、有空态文案），
  //    纯看 DOM 结构完全看不出问题 —— 必须把「数字与独立算出来的总量对上」写成断言。
  const gamesTabTexts = await page.$$eval('.pf__btn', (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, ' ').trim())
  )
  const gCounts = {}
  gamesTabTexts.forEach((t) => {
    const m = t.match(/^(\S+)\s*(\d+)?$/)
    if (m) gCounts[m[1]] = m[2] === undefined ? undefined : Number(m[2])
  })
  assert(
    'C2a 游戏库「全部」数字 = 接口游戏总数',
    gCounts['全部'] === truth.games,
    `页面=${gCounts['全部']} 接口=${truth.games}`
  )
  const gZero = Object.keys(LABEL_TO_VALUE).filter((label) => !(gCounts[label] > 0))
  assert('C2b 各平台款数均 > 0（空响应/坏缓存会让它变 0）', gZero.length === 0, gZero.join(',') || JSON.stringify(gCounts))
  const gSum = Object.keys(LABEL_TO_VALUE).reduce((n, label) => n + (gCounts[label] || 0), 0)
  assert(
    'C2c 各平台款数之和 ≤ 全部（未重复计数，且有平台归属）',
    gSum > 0 && gSum <= (gCounts['全部'] || 0),
    `和=${gSum} 全部=${gCounts['全部']}`
  )

  const genreN = await count('.chip')
  // C3a/C3b（2026-09-20 二次调整）：类型不再做「二次分类筛选」。
  //   整行类型 chip 已按用户反馈**完全移除**，标签改为只能通过搜索命中（见 C6*）。
  assert('C3a 类型筛选行已移除（不再有二次分类 chip）', genreN === 0, `chip=${genreN}`)
  assert(
    'C3b 类型行容器也不在了（无 .chips）',
    (await count('.chips')) === 0,
    `chips=${await count('.chips')}`
  )
  await page.screenshot({ path: path.join(SHOTS, 'C-games.png') })

  // 筛选 PC —— 判据是「请求真的带上了 platform=PC」，与数据分布无关（原来断言数量变化太脆）
  const chipsG = await page.$$('.pf__btn')
  let pcChip = null
  for (const c of chipsG) {
    if ((await c.innerText()).replace(/\s+/g, '').startsWith('PC')) pcChip = c
  }
  const [pcReq] = await Promise.all([
    page
      .waitForRequest((r) => r.url().includes('/api/games') && /platform=pc/i.test(r.url()), { timeout: 9000 })
      .catch(() => null),
    pcChip ? pcChip.click() : Promise.resolve()
  ])
  await sleep(2000)
  assert('C4 选「PC」后请求带上 platform=PC', !!pcReq, pcReq ? pcReq.url().replace(/^https?:\/\/[^/]+/, '') : '未捕获到筛选请求')
  assert('C5 筛选后仍有结果', (await count('.gitem')) > 0, `gitem=${await count('.gitem')}`)

  // 类型改为「搜索即达」（2026-09-20）：在搜索框输入类型名，端内解析成 genre，
  //   请求要带上 `genre=<类型>`、**且不再带 keyword**；结果卡片角标必须全部是该类型。
  //   类型从**独立算出的类型分布**里挑（挑收录最多的那个），不看页面自证。
  await goto('/pages/games/games')
  const topGenre =
    Object.keys(truth.genres || {}).sort((a, b) => truth.genres[b] - truth.genres[a])[0] || ''
  if (topGenre) {
    const hitReq = (r) => {
      const u = decodeURIComponent(r.url())
      return u.includes('/api/games') && u.includes('genre=' + topGenre)
    }
    const [geReq] = await Promise.all([
      page.waitForRequest(hitReq, { timeout: 9000 }).catch(() => null),
      page.fill('input.uni-input-input', topGenre).catch(() => {})
    ])
    await sleep(1800)
    const geUrl = geReq ? decodeURIComponent(geReq.url().replace(/^https?:\/\/[^/]+/, '')) : ''
    assert('C6 搜索类型名 → 请求带 genre 精确筛选', !!geReq, geUrl || `未捕获（类型=${topGenre}）`)
    assert('C6b 类型搜索不再发 keyword（避免被名称 like 反抢）', !!geReq && !/[?&]keyword=/.test(geUrl), geUrl)

    // 结果判据：卡片上「非平台」的角标（= 类型角标）必须全部等于该类型
    const badgeGenres = await page.$$eval('.gitem__tags .mp-tag:not(.mp-tag--purple)', (els) =>
      els.map((e) => e.innerText.trim())
    )
    assert(
      `C6c 搜索结果全部属于类型「${topGenre}」`,
      badgeGenres.length > 0 && badgeGenres.every((t) => t.toLowerCase() === topGenre.toLowerCase()),
      badgeGenres.slice(0, 4).join('|') || '无类型角标'
    )
    const shownG = await count('.gitem')
    assert(
      'C6d 结果条数 ≤ 该类型真实总数（独立分布）',
      shownG <= truth.genres[topGenre],
      `页面 ${shownG} ≤ 接口 ${truth.genres[topGenre]}`
    )
  } else {
    assert('C6 搜索类型名 → 请求带 genre 精确筛选', false, '没算出任何类型（接口异常？）')
    assert('C6b 类型搜索不再发 keyword（避免被名称 like 反抢）', false)
    assert('C6c 搜索结果全部属于该类型', false)
    assert('C6d 结果条数 ≤ 该类型真实总数（独立分布）', false)
  }
  await page.screenshot({ path: path.join(SHOTS, 'C-games-genre.png') })

  // 搜索防抖：输入后**不发请求也能自动刷新**（原来只在回车时才查）
  // ⚠️ uni-app H5 的 `<input>` 渲染成 `<uni-input>` 包一层，`fill` 必须打到真正的
  //    `<input class="uni-input-input">` 上，直接 fill 自定义元素会失败（静默 → 假失败）
  await goto('/pages/games/games')
  const beforeKw = await count('.gitem')
  const [kwReq] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/api/games') && /keyword=/.test(r.url()), { timeout: 9000 }).catch(() => null),
    page.fill('input.uni-input-input', '原神').catch(() => {})
  ])
  await sleep(1800)
  assert('C7 输入关键词自动触发搜索（350ms 防抖）', !!kwReq, kwReq ? '已捕获 keyword 请求' : '未捕获（可能仍需回车）')
  const afterKw = await count('.gitem')
  assert('C8 搜索结果收敛', afterKw >= 1 && afterKw <= beforeKw, `before=${beforeKw} after=${afterKw}`)

  // 上拉加载（current 自增）—— 单独用一次干净导航，避免与筛选相互干扰
  await goto('/pages/games/games')
  const before = await count('.gitem')
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await sleep(1200)
  }
  const after = await count('.gitem')
  assert('C9 上拉加载生效（current 参数正确）', after > before, `before=${before} after=${after}`)
  assert('C10 底部状态文案存在', (await text('.footer')).length > 0, await text('.footer'))

  /* ================= D. 资讯 ================= */
  console.log('\n--- D. 资讯（资讯速递频道 = board 4 全量）---')
  await goto('/pages/news/news')
  assert('D1 资讯列表渲染', (await count('.pc')) >= 1, `pc=${await count('.pc')}`)
  assert('D2 平台筛选条 5 档', (await count('.pf__btn')) === 5)
  assert('D3 排序 chip 3 档', (await count('.sortchip')) === 3)
  // D4 资讯卡片带平台角标（官方帖也带 gameId ⇒ 平台归类同样有效）
  const dPlat = await page.$$eval('.pc__plat', (els) => els.map((e) => e.innerText.trim()))
  assert('D4 资讯卡片带平台角标', dPlat.length >= 1, `${dPlat.length} 个角标`)
  //
  // ⚠️ 旧写法是直接 JSON.parse(localStorage.getItem('yumu_guide_index')) 读端内索引，
  //    结果恒为 0 —— 因为 uni-app H5 的 uni.setStorageSync 会给对象套一层
  //    `{type,data}` 信封，裸 JSON.parse 拿到的是信封而不是索引本体。
  //    这是**脚本自身的坑**（已改成读接口真值），不是产品问题。
  const newsCountText = await text('.bar__count')
  const newsPageNum = Number((newsCountText.match(/\d+/) || [])[0])
  // D5（2026-09-21 二次调整）：本页不再是「官方情报站」，而是**资讯速递频道** ——
  //    出 board 4 的**全部**帖（官方公告 + 玩家投稿）。判据 = 接口独立统计的 board4 篇数。
  //    上一版这里是 `=== truth.official`（只出官方帖），就是被这次调整替换掉的旧口径。
  assert(
    'D5 资讯页 = 资讯速递全量（条数 = 接口独立统计的 board4 篇数）',
    truth.news > 0 && newsPageNum === truth.news,
    `页面「${newsCountText}」 接口 board4=${truth.news}（其中官方帖 ${truth.official}）`
  )
  // D6 官方帖**默认置顶**（落库 is_top=1，2026-09-21 新增口径）：
  //    官方帖按 is_top 优先排在列表最前，所以首屏 PAGE=12 张里应当**全是**官方帖
  //    （官方帖不足 12 条时即为官方帖总数）。这条同时验证
  //    `db-seed/fetch_official.py` 写入的 is_top=1 真的生效 ——
  //    端内权重排序走 `guideQuery.cmpLatest`（isTop 排首位），与后端 ORDER BY 同口径。
  //    ⚠️ `newsPc` 数的是整页所有 `.pc`（含顶部「今日精选」卡片）；线上该接口返回空数组、
  //       这块不渲染，所以当前等价于主列表卡片数。
  const newsPc = await count('.pc')
  const newsOfficial = await count('.pc__badge--official')
  const expectTop = Math.min(12, truth.official)
  assert(
    'D6 官方帖默认置顶：资讯页首屏卡片全部为官方帖',
    expectTop >= 1 && newsOfficial === expectTop,
    `首屏卡片=${newsPc} 其中官方=${newsOfficial} 期望=${expectTop}（官方帖共 ${truth.official}）`
  )
  // D7 官方帖必须都在资讯速递板块内（否则是把官方帖发错了板块，或分流写反了）
  assert(
    'D7 官方帖数不超过 board4 篇数（未跑到攻略心得板块）',
    truth.official <= truth.byBoard[4],
    `官方帖=${truth.official} board4=${truth.byBoard[4]}`
  )
  await page.screenshot({ path: path.join(SHOTS, 'D-news.png') })

  /* ====== T. 游戏详情页：攻略 / 资讯 必须按板块分开（2026-09-21 新增） ====== */
  //
  // 🚨 这一组是用户截图反馈的直接回归防线：「三角洲行动」详情页的
  //    「攻略」「资讯」两个 Tab 拿到**完全相同的列表**。
  //    根因不在前端 —— 小程序一直传 `/games/{id}/posts?boardId=1|4`，
  //    但后端 `GameController#posts` **没有 `boardId` 参数**，Spring 静默丢弃未知查询参数。
  //
  //    ⚠️ 这类「参数写了没效果」的故障，**页面自证是抓不到的** —— 两个 Tab 都渲染得好好的，
  //       不比不知道。所以期望值必须取**接口按板块过滤后的真值**（truth.detail 独立打接口算）。
  //
  //    ⚠️ 组号用 `T`（Tabs）：`F` 已被「搜索链路统一口径」那一组占用（F1–F15），
  //       `G/H/L/R` 也都各有归属。新增断言组前先 grep 一遍已用前缀，别重号 ——
  //       重号的代价是报告里出现两个 F1，排查时根本分不清哪条挂了（A11 也踩过一次，见 A10b）。
  console.log('\n--- T. 游戏详情页（攻略=board1 / 资讯=board4，两 Tab 不得相同）---')
  if (!truth.detail) {
    assert('T0 找到「两板块都有帖」的游戏用于交叉验证', false, '接口没返回可用于验证的游戏')
  } else {
    const gid = truth.detail.id
    const titlesOf = () =>
      page.$$eval('.pc__title', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))

    // 详情页 pageSize=10（usePagedList 默认），故两边都只比首屏 10 条
    await goto(`/pages/game/detail?id=${gid}`)
    await waitFor('.pc', 12000)
    const guideTitles = await titlesOf()
    const wantGuide = truth.detail.b1.slice(0, 10)
    assert(
      'T1 攻略 Tab 只出「攻略心得」（卡片标题全在 board1 真值内）',
      wantGuide.length > 0 && guideTitles.length === wantGuide.length &&
        guideTitles.every((t) => wantGuide.includes(t)),
      `页面=${guideTitles.length} 期望=${wantGuide.length} 尾部「${await text('.footer')}」`
    )

    // 切到「资讯」Tab（.tabs 下第 2 个 item）
    await page.click('.tabs__item:nth-child(2)')
    await sleep(2200)
    const newsTitles = await titlesOf()
    const wantNews = truth.detail.b4.slice(0, 10)
    assert(
      'T2 资讯 Tab 只出「资讯速递」（卡片标题全在 board4 真值内）',
      wantNews.length > 0 && newsTitles.length === wantNews.length &&
        newsTitles.every((t) => wantNews.includes(t)),
      `页面=${newsTitles.length} 期望=${wantNews.length}`
    )

    // T3 两 Tab 内容必须**真的不同** —— 这条就是用户看到的问题本身。
    //    重合数要与「真值之间的重合数」一致：真值本身有重合时不能用 0 当判据，
    //    否则会误报；而后端一旦又丢掉 boardId，页面重合数会远大于真值重合数 ⇒ 报红。
    const overlap = newsTitles.filter((t) => guideTitles.includes(t)).length
    const wantOverlap = wantNews.filter((t) => wantGuide.includes(t)).length
    assert(
      'T3 两个 Tab 内容不再混在一起（页面重合数 = 真值重合数）',
      guideTitles.length > 0 && newsTitles.length > 0 && overlap === wantOverlap,
      `攻略=${guideTitles.length} 资讯=${newsTitles.length} 重合=${overlap} 真值重合=${wantOverlap}`
    )
    await page.screenshot({ path: path.join(SHOTS, 'T-detail-news.png') })
  }

  // T4/T5 官方帖所在的那款游戏：攻略 Tab 不得夹带官方帖；资讯 Tab 官方帖三重标识
  if (!truth.officialGame) {
    console.log('   ⏭ T4/T5 跳过：board4 里没找到官方帖所在的游戏')
    assert('T4 找到官方帖所在的游戏', false, 'board4 里没有官方帖')
  } else {
    const og = truth.officialGame
    await goto(`/pages/game/detail?id=${og.id}`)
    await waitFor('.empty, .pc', 12000)
    const gCards = await count('.pc')
    const gOfficial = await count('.pc__badge--official')
    if (og.b1Total === 0) {
      // 用户截图场景：该游戏只有官方公告、没有攻略
      assert(
        'T4 攻略 Tab 空态（该游戏 board1 确实无帖）',
        gCards === 0 && (await count('.empty')) === 1,
        `卡片=${gCards} 空态=${await count('.empty')} 文案「${await text('.empty__text')}」`
      )
    } else {
      assert(
        'T4 攻略 Tab 只有攻略心得、不含官方帖',
        gCards > 0 && gOfficial === 0,
        `卡片=${gCards} 官方标签=${gOfficial}（该游戏 board1 共 ${og.b1Total} 条）`
      )
    }

    await page.click('.tabs__item:nth-child(2)')
    await sleep(2200)
    const ogCards = await count('.pc')
    const ogOfficial = await count('.pc__badge--official')
    const ogTop = await count('.pc__badge--top')
    const ogBest = await count('.pc__badge--best')
    // 官方帖按 is_top=1 置顶 ⇒ 资讯 Tab 的**前 officialCount 张**必然是官方帖
    // （条数不足一屏时就是全部卡片）。因此这三个角标的数量应等于 min(卡片数, 官方帖数)。
    const wantBadges = Math.min(ogCards, og.officialCount)
    assert(
      'T5 资讯 Tab 官方帖带「官方+置顶+精华」三重标识（且置顶在最前）',
      ogCards > 0 && wantBadges >= 1 &&
        ogOfficial === wantBadges && ogTop === wantBadges && ogBest === wantBadges,
      `卡片=${ogCards} 官方=${ogOfficial} 置顶=${ogTop} 精华=${ogBest}`
        + ` 期望=${wantBadges}（该游戏官方帖 ${og.officialCount} 条 / board1 ${og.b1Total} 条）`
    )
    await page.screenshot({ path: path.join(SHOTS, 'T-official-game.png') })
  }

  /* ================= E. 我的 ================= */
  console.log('\n--- E. 我的 ---')
  await goto('/pages/my/my')
  assert('E1 账号区渲染', (await count('.user')) === 1)
  assert('E2 收藏 / 点赞 / 历史 三 Tab', (await count('.tabs__item')) === 3, `tab=${await count('.tabs__item')}`)
  const myContent = await page.content()
  assert('E3 明确说明记录保存在本机', /本机/.test(myContent))
  assert('E4 不出现「未登录」这种像坏掉的文案', !myContent.includes('未登录'))
  await page.screenshot({ path: path.join(SHOTS, 'E-my.png') })
  // E5 上一节点赞过的内容要出现在「我赞过的」里（同一浏览器上下文，localStorage 是共享的）
  const likeTab = (await page.$$('.tabs__item'))[1]
  if (likeTab) {
    await likeTab.click()
    await sleep(600)
    assert('E5 「点赞」Tab 可切换且有内容（本机点赞可见）', (await count('.item')) >= 1, `item=${await count('.item')}`)
  } else {
    assert('E5 「点赞」Tab 可切换且有内容（本机点赞可见）', false)
  }

  /* ================= F. 搜索 ================= */
  console.log('\n--- F. 搜索（帖子走端内索引，游戏走 /games 分页）---')

  // 只在本组期间收集接口请求，用来核对「游戏一路到底打了哪个接口」
  const fGameReqs = []
  const fSearchReqs = []
  const fRec = (r) => {
    const u = decodeURIComponent(r.url())
    if (u.includes('/api/games')) fGameReqs.push(u)
    if (u.includes('/api/search')) fSearchReqs.push(u)
  }
  page.on('request', fRec)

  // 清掉搜索历史，尽量让 F13 读到的是本轮真的写进去的记录（清不掉也不影响判定）
  await goto('/pages/index/index')
  await page.evaluate(() => {
    try {
      uni.removeStorageSync('yumu_search_history')
    } catch (e) {}
  })
  fGameReqs.length = 0
  fSearchReqs.length = 0

  await goto('/pages/search/search?keyword=' + encodeURIComponent('原神'))
  const searchContent = await page.content()
  assert('F1 搜索结果含关键词命中', searchContent.includes('原神'))
  assert('F2 类型 Tab 3 档', (await count('.tabs__item')) === 3)
  assert('F3 端内命中区块渲染', /攻略 \/ 资讯/.test(await text('.mp-sec__title').catch(() => '')) || (await count('.pc')) > 0, `pc=${await count('.pc')}`)
  assert('F4 提示了在多少篇干货中搜索', /在\s*\d+\s*篇/.test(searchContent), '')
  await page.screenshot({ path: path.join(SHOTS, 'F-search.png') })

  // F5/F6（2026-09-21 重构）：游戏一路必须走 `/games`（服务端分页、有 total），
  //   不能再走 `/search?type=game` —— 它内部写死 `LIMIT 8`、无分页无总数，
  //   而且把 `publisher` 也当匹配字段，正是「搜『资讯』搜出《仙剑奇侠传》」的元凶
  //   （《仙剑》的发行商叫「大宇**资讯**」，纯属公司名撞词）。
  assert(
    'F5 游戏结果走 /games 分页接口（不再打 /search?type=game）',
    fGameReqs.some((u) => /\/api\/games\?/.test(u)) && !fSearchReqs.some((u) => /type=game/.test(u)),
    `games=${fGameReqs.length} search=${fSearchReqs.length}`
  )
  assert('F6 游戏区块显示「共 N 款」（/search 那套没有总数）', /共\s*\d+\s*款/.test(await page.content()), '')

  // F7/F8：类型名当搜索词 → 端内解析成 genre，请求带 `genre=` 精确筛选且**不带 keyword**
  //   类型从**独立算出的类型分布**里挑（收录最多的那个），不看页面自证
  const fGenre = Object.keys(truth.genres || {}).sort((a, b) => truth.genres[b] - truth.genres[a])[0] || ''
  if (fGenre) {
    await goto('/pages/search/search')
    const [geReqS] = await Promise.all([
      page
        .waitForRequest((r) => {
          const u = decodeURIComponent(r.url())
          return u.includes('/api/games') && u.includes('genre=' + fGenre)
        }, { timeout: 9000 })
        .catch(() => null),
      page.fill('input.uni-input-input', fGenre).catch(() => {})
    ])
    await sleep(1800)
    const geUrlS = geReqS ? decodeURIComponent(geReqS.url().replace(/^https?:\/\/[^/]+/, '')) : ''
    assert('F7 搜索页搜类型名 → 请求带 genre 精确筛选', !!geReqS, geUrlS || `未捕获（类型=${fGenre}）`)
    assert('F7b 类型搜索不再发 keyword（避免被名称 like 反抢）', !!geReqS && !/[?&]keyword=/.test(geUrlS), geUrlS)
    const gsContent = await page.content()
    assert('F8 命中原因回显（卡片标注「类型 · XXX」）', gsContent.includes('类型 · ' + fGenre), `期望含「类型 · ${fGenre}」`)
  } else {
    assert('F7 搜索页搜类型名 → 请求带 genre 精确筛选', false, '没算出任何类型（接口异常？）')
    assert('F7b 类型搜索不再发 keyword', false)
    assert('F8 命中原因回显（类型）', false)
  }
  await page.screenshot({ path: path.join(SHOTS, 'F-search-genre.png') })

  // F9-F11：平台词 → `platform=` 精确筛选；结果还能**翻页**
  //   （「能翻页」正是换接口最直接的收益：原来 `/search?type=game` 恒定最多 8 条、翻不动）
  await goto('/pages/search/search')
  const [pfReqS] = await Promise.all([
    page
      .waitForRequest((r) => {
        const u = decodeURIComponent(r.url())
        return u.includes('/api/games') && /platform=pc/i.test(u)
      }, { timeout: 9000 })
      .catch(() => null),
    page.fill('input.uni-input-input', 'PC').catch(() => {})
  ])
  await sleep(1800)
  assert('F9 搜索页搜平台词 → 请求带 platform=PC', !!pfReqS, pfReqS ? '已捕获' : '未捕获')
  assert('F10 命中原因回显（卡片标注「平台 · PC」）', (await page.content()).includes('平台 · PC'), '')

  const beforeMore = await count('.gitem')
  const [moreReqS] = await Promise.all([
    page
      .waitForRequest((r) => /\/api\/games\?/.test(r.url()) && /current=2/.test(r.url()), { timeout: 9000 })
      .catch(() => null),
    page.locator('.more--games').first().click().catch(() => {})
  ])
  await sleep(1800)
  const afterMore = await count('.gitem')
  assert('F11 游戏结果可「加载更多」（请求翻到 current=2）', !!moreReqS, moreReqS ? '已捕获' : `未捕获（before=${beforeMore}）`)
  assert('F11b 加载更多后卡片数增加', afterMore > beforeMore, `before=${beforeMore} after=${afterMore}`)

  // F12：输入即搜 —— 不按回车，防抖到点自动出结果
  await goto('/pages/search/search')
  const [autoReq] = await Promise.all([
    page
      .waitForRequest((r) => /\/api\/games\?/.test(r.url()) && /keyword=/.test(decodeURIComponent(r.url())), { timeout: 9000 })
      .catch(() => null),
    page.fill('input.uni-input-input', '原神').catch(() => {})
  ])
  // ⚠️ 必须 >1.5s：写「搜索历史」的防空闲门槛**故意**比搜索防抖长 ——
  //    这是为了让「原」「原神」这种打字中途的半截词不进历史
  await sleep(2200)
  assert('F12 输入即搜（不按回车也自动发请求）', !!autoReq, autoReq ? '已捕获' : '未捕获（可能仍需回车）')

  // F13-F15：搜索历史 —— 刚搜过的词要出现在「未搜索态」，可复搜、可清空
  await goto('/pages/search/search')
  const hisContent = await page.content()
  const hisTexts = await page.$$eval('.tag--his', (els) => els.map((e) => e.innerText.trim()))
  assert('F13 未搜索态展示「最近搜索」区块', hisContent.includes('最近搜索') && hisTexts.length >= 1, hisTexts.join('|'))
  assert(
    'F14 历史里含刚搜过的词（原神 / PC）',
    hisTexts.includes('原神') || hisTexts.some((t) => /^pc$/i.test(t)),
    hisTexts.join('|')
  )
  await page.locator('.mp-sec__more').first().click().catch(() => {})
  await sleep(700)
  const hisAfter = await count('.tag--his')
  assert('F15 可清空搜索历史', hisAfter === 0, `残留 ${hisAfter}`)
  await page.screenshot({ path: path.join(SHOTS, 'F-search-history.png') })

  page.off('request', fRec)

  /* ================= G. 全局 ================= */
  console.log('\n--- G. 全局 ---')
  assert('G1 tabBar 存在', (await count('uni-tabbar')) >= 1 || (await count('.uni-tabbar')) >= 1)
  const hardErrors = errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e))
  assert('G2 无 JS 运行时错误', hardErrors.length === 0, hardErrors.slice(0, 2).join(' | '))
  if (hardErrors.length) console.log('   错误明细：\n     ' + hardErrors.slice(0, 8).join('\n     '))

  // G3 移动端 viewport：生产 CSP 会拦掉 uni-app 模板里的内联脚本，
  //    导致真机上没有 viewport meta、按桌面宽度渲染（不会白屏，只看报错查不出来）
  const vp = await page.evaluate(() => {
    const m = document.querySelector('meta[name="viewport"]')
    return m ? m.getAttribute('content') || '' : null
  })
  assert('G3 viewport meta 正确（width=device-width）', !!vp && /width=device-width/.test(vp), vp === null ? '缺失（可能被 CSP 拦掉内联脚本）' : vp)

  // G4 图片真的加载出来了（判据是网络响应，不是「DOM 里有 image」）
  const badPath = fileReqs.filter((r) => /\/m\/api\/files\//.test(r.url))
  const notImage = fileReqs.filter((r) => r.status !== 200 || !r.ct.startsWith('image/'))
  assert('G4a 图片路径未被路由 base 污染（无 /m/api/files/）', badPath.length === 0, badPath.slice(0, 2).map((r) => r.url).join(' | '))
  assert(
    'G4b 图片全部 200 且为 image/*',
    fileReqs.length >= 8 && notImage.length === 0,
    `共 ${fileReqs.length} 个请求，异常 ${notImage.length} 个`
  )

  // G5 tabBar 图标
  const tbIcons = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('uni-tabbar img'))
    return { n: imgs.length, decoded: imgs.filter((i) => i.naturalWidth > 0).length }
  })
  assert('G5a tabBar 有 4 个图标', tbIcons.n === 4, `n=${tbIcons.n}`)
  assert('G5b tabBar 图标真实解码', tbIcons.decoded === 4, `decoded=${tbIcons.decoded}`)
  // G5c（2026-09-20）：底部导航顺序调整为 攻略 → 资讯 → 游戏库 → 我的（游戏库与资讯互换）。
  //   用「相对次序」而不是精确字符串，避免受 tabBar 内部空白/换行影响。
  const tbTxt = await page.evaluate(() => {
    const el = document.querySelector('uni-tabbar') || document.querySelector('.uni-tabbar')
    if (!el) return ''
    const labels = Array.from(el.querySelectorAll('.uni-tabbar__label, .uni-tabbar__text'))
    const s = labels
      .map((x) => (x.innerText || x.textContent || '').trim())
      .filter(Boolean)
      .join(' ')
    return s || (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  })
  const iNews = tbTxt.indexOf('资讯')
  const iGames = tbTxt.indexOf('游戏库')
  assert(
    'G5c 底部导航顺序：资讯 在 游戏库 之前',
    iNews >= 0 && iGames >= 0 && iNews < iGames,
    tbTxt || '未读到 tabBar 文本'
  )

  /* ---- G6 H5 宽屏：内容栏必须有宽度上限 ----
     本项目的**主交付渠道是 H5**（小程序不上架）。改版前实测 1440px 下帖子卡被拉到 1412px，
     一行上百个汉字没法读。这里直接用桌面视口量卡片宽度。 */
  console.log('\n--- G6. H5 宽屏（1440px）---')
  const wideCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const wp = await wideCtx.newPage()
  await wp.goto(`${BASE}/?t=${Date.now()}#/pages/index/index`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await sleep(3200)
  const met = await wp.evaluate(() => {
    const card = document.querySelector('.pc')
    const w = card ? card.getBoundingClientRect().width : 0
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
    return { w: Math.round(w), overflow }
  })
  assert('G6a 宽屏下卡片宽度受约束（≤820px）', met.w > 0 && met.w <= 820, `卡片宽=${met.w}px（改版前 1412px）`)
  assert('G6b 宽屏无横向溢出', met.overflow <= 2, `溢出=${met.overflow}px`)

  /* ---- G7 图片可读名：判据在 `<uni-image>` 包装层，**不是**内层 `<img>` ----
     🚨 2026-09-17 实测：uni-app H5 的 `<image>` **不会把 `alt` 透传给内部 `<img>`**
     （页面上 16 个真实 `<img>`，0 个带 alt 属性）。所以「补 alt」在 H5 是无效动作，
     必须把可读名挂在包装层：`role="img"` + `aria-label`。

     ⚠️ 这条断言必须打包装层的 `aria-label`。打 `img[alt]` 的话，改对了也永远报红
     （H5 下恒为空），等于把一个**假问题**焊进回归 —— 判据落在哪一层，比断言写得多严更重要。 */
  const imgA11y = await wp.evaluate(() => {
    const ws = Array.from(document.querySelectorAll('uni-image')).filter(
      (el) => !/tabbar/i.test(el.className || '')
    )
    return {
      total: ws.length,
      named: ws.filter((el) => (el.getAttribute('aria-label') || '').trim()).length,
      innerWithAlt: ws.filter((el) => {
        const i = el.querySelector('img')
        return !!(i && i.getAttribute('alt'))
      }).length
    }
  })
  assert(
    'G7 内容图都有可读名（挂 uni-image 的 aria-label —— H5 会丢弃 alt）',
    imgA11y.total > 0 && imgA11y.named === imgA11y.total,
    `内容图 ${imgA11y.total} 个，有 aria-label ${imgA11y.named} 个，内层 img 带 alt ${imgA11y.innerWithAlt} 个`
  )

  await wp.screenshot({ path: path.join(SHOTS, 'R-1440.png') })
  await wideCtx.close()

  /* ================= H. 断网 / 失败态 ================= */
  console.log('\n--- H. 断网时的表现 ---')
  await page.route('**/api/**', (r) => r.abort())
  await goto('/pages/games/games')
  const offlineTxt = await page.content()
  const errN = await count('.err')
  assert('H1 断网时渲染失败态 + 重试按钮', errN >= 1 && (await count('.err__btn')) >= 1, `err=${errN}`)
  assert('H2 断网时**不**说成「没有找到匹配的游戏」', !offlineTxt.includes('没有找到匹配的游戏'), offlineTxt.includes('没有找到匹配的游戏') ? '仍在用空态话术' : '')
  await page.screenshot({ path: path.join(SHOTS, 'Z-offline-games.png') })

  await page.unroute('**/api/**')
  const retryBtn = await page.$('.err__btn')
  if (retryBtn) await retryBtn.click()
  await sleep(2600)
  assert('H3 点重试后恢复出数据', (await count('.gitem')) >= 10, `gitem=${await count('.gitem')}`)
  assert('H4 恢复后失败态消失', (await count('.err')) === 0)
  await page.screenshot({ path: path.join(SHOTS, 'Z-recovered-games.png') })

  // H5 首页断网：端内索引同步失败且**没有旧缓存可用**时必须给失败态，
  //    不能把「同步失败」渲染成「还没有内容」——这是本项目反复踩的那类坑。
  await page.route('**/api/**', (r) => r.abort())
  await ctx.clearCookies().catch(() => {})
  await page.evaluate(() => localStorage.clear()).catch(() => {})
  await goto('/pages/index/index')
  const homeOff = await page.content()
  assert('H5 首页同步失败 → 失败态（不是「还没有内容」）', (await count('.err')) >= 1, `err=${await count('.err')}`)
  assert('H6 失败态说明是同步失败并给了重试', /同步失败/.test(homeOff) && (await count('.err__btn')) >= 1)
  await page.screenshot({ path: path.join(SHOTS, 'Z-offline-home.png') })
  await page.unroute('**/api/**')

  /* ================= L. 登录与举报（2026-09-17 新增） ================= */
  // 登录/注册（与主站账号通用）+ 详情页举报（进主站审核流程）。
  // 这里只锁 **UI 行为**（页面可达、入口存在、未登录跳转）；真实提交链路由
  // 本地端到端 curl 序列覆盖（注册→登录→POST /reports→admin 列表可见），
  // 因为线上是生产环境（无 MAIL_TEST_CODE），自动化注册只可能在本地成立。
  console.log('\n--- L. 登录与举报 ---')
  await goto('/pages/login/login')
  await new Promise((r) => setTimeout(r, 800))
  assert('L1 登录页渲染（登录/注册双 tab）', (await count('.seg__item')) === 2 && (await count('.field__input')) >= 2, `seg=${await count('.seg__item')} inputs=${await count('.field__input')}`)

  await goto('/pages/post/detail?id=' + candIds[0])
  await new Promise((r) => setTimeout(r, 1500))
  assert('L2 详情页有举报入口', (await count('.author__report')) === 1, `report=${await count('.author__report')}`)

  // 未登录（新 context：storage 为空）点击举报 → 提示 + 跳转登录页
  const anonCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const anonPage = await anonCtx.newPage()
  const anonErrs = []
  anonPage.on('pageerror', (e) => anonErrs.push(String(e)))
  await anonPage.goto(BASE + '/#/pages/post/detail?id=' + candIds[0], { waitUntil: 'networkidle' })
  await new Promise((r) => setTimeout(r, 1800))
  await anonPage.click('.author__report')
  await new Promise((r) => setTimeout(r, 1200))
  const anonHash = await anonPage.evaluate(() => location.hash)
  assert('L3 未登录点举报 → 跳转登录页', /pages\/login\/login/.test(anonHash), `hash=${anonHash}`)
  await anonCtx.close()
  void anonErrs

  /* ---- L4-L7：忘记密码 + 注册协议勾选（2026-09-17 下午新增，对齐主站 C3/忘记密码设计） ---- */

  // L4：登录页「忘记密码？」→ 独立视图（无 Tab、四个字段、返回登录）
  await goto('/pages/login/login')
  await new Promise((r) => setTimeout(r, 800))
  await page.click('.forgot-row__link')
  await new Promise((r) => setTimeout(r, 400))
  const fpTitle = await text('.forgot-head__title')
  assert(
    'L4a 忘记密码是独立视图（无登录/注册 Tab、标题正确、4 个输入框）',
    fpTitle.includes('忘记密码') && (await count('.seg__item')) === 0 && (await count('.field__input')) === 4,
    `标题=${fpTitle} tab=${await count('.seg__item')} inputs=${await count('.field__input')}`
  )
  await page.click('.forgot-row__link') // 「← 返回登录」复用同一行样式
  await new Promise((r) => setTimeout(r, 400))
  assert('L4b 忘记密码可返回登录', (await count('.seg__item')) === 2, `tab=${await count('.seg__item')}`)

  // L5：协议勾选行**只在注册 Tab** 出现，且带两个主站协议页链接
  await page.click('.seg__item:nth-child(2)')
  await new Promise((r) => setTimeout(r, 400))
  const agreeLinks = await page.$$eval('.agree__link', (els) => els.map((e) => e.innerText))
  assert(
    'L5a 注册 Tab 有协议勾选行（《用户协议》《隐私政策》）',
    (await count('.agree')) === 1 && agreeLinks.length === 2 && agreeLinks.join(',').includes('用户协议') && agreeLinks.join(',').includes('隐私政策'),
    `agree=${await count('.agree')} links=${JSON.stringify(agreeLinks)}`
  )
  await page.click('.seg__item:nth-child(1)')
  await new Promise((r) => setTimeout(r, 300))
  assert('L5b 勾选行不在登录 Tab 出现', (await count('.agree')) === 0, `agree=${await count('.agree')}`)
  await page.click('.seg__item:nth-child(2)')
  await new Promise((r) => setTimeout(r, 300))

  // L6：注册未勾选协议 → 被拦截，**不发** /auth/register 请求（判据=网络事实，不是 DOM）
  // ⚠️ 与本脚本 456 行同一条坑：uni-input 是自定义元素，fill 必须打在内层 `input.uni-input-input` 上。
  const regInputs = await page.$$('input.uni-input-input')
  await regInputs[0].fill('regprobe1') // 账号id
  await regInputs[1].fill('test123456') // 密码
  await regInputs[2].fill('probe@test.local') // 邮箱
  await regInputs[3].fill('123456') // 验证码
  const regReqs = []
  const onRegReq = (u) => regReqs.push(u)
  page.on('request', (r) => {
    if (/\/api\/auth\/register/.test(r.url())) onRegReq(r.url())
  })
  await page.click('.submit')
  await new Promise((r) => setTimeout(r, 1000))
  const bodyTxt = await page.evaluate(() => document.body.innerText)
  assert(
    'L6 未勾选协议时注册被拦截（无 register 请求 + 提示语）',
    regReqs.length === 0 && bodyTxt.includes('请先阅读并同意'),
    `register请求=${regReqs.length} 提示出现=${bodyTxt.includes('请先阅读并同意')}`
  )
  page.off('request', (r) => {
    if (/\/api\/auth\/register/.test(r.url())) onRegReq(r.url())
  })

  // L7：协议链接打开**主站**协议页（window.open 打桩，判据=真实 URL）
  await page.evaluate(() => {
    window.__opened = []
    window.open = (u) => {
      window.__opened.push(String(u))
      return null
    }
  })
  // ⚠️ uni-app H5 会把 <text> 编译成 <uni-text>，nth-of-type 在全部 uni-text 兄弟间计数，
  //     用 `.agree__link:nth-of-type(1)` 会扑空 —— 直接拿两个链接的元素句柄点击。
  const legalLinks = await page.$$('.agree__link')
  await legalLinks[0].click() // 《用户协议》
  await legalLinks[1].click() // 《隐私政策》
  await new Promise((r) => setTimeout(r, 400))
  const opened = await page.evaluate(() => window.__opened || [])
  assert(
    'L7 协议链接指向主站 /agreement 与 /privacy',
    opened.length === 2 && /\/agreement$/.test(opened[0]) && /\/privacy$/.test(opened[1]),
    `opened=${JSON.stringify(opened)}`
  )
  await page.screenshot({ path: path.join(SHOTS, 'L-register-agree.png') })

  /* ================= R. 「平台分类全 0」事故回归（2026-09-20） =================
   * 真机事故的完整链条（详见 miniprogram/src/utils/apiGuard.js 头部复盘）：
   *   ① query 里混进 `undefined` → 被后端当成真筛选值 ⇒ `code:200` + `records:[]` 的**空成功**；
   *   ② 元数据缓存不校验内容 ⇒ 把「80 款游戏」缓存成「0 款」（map:{}，TTL 24h）；
   *   ③ 帖子索引（TTL 10min）拿空映射反复重建 ⇒ 254 篇平台归属全落成 '' ⇒ 每个平台都是 0。
   *
   * 🚨 为什么原来那 94 项全绿却漏了这个：**H5 每次都是干净存储**，
   *    一上来就重新同步，永远走不到「读坏缓存」那条路；而真机上缓存是持久的。
   *    所以本节**主动制造事故环境**（注入空响应 / 注入坏缓存），把修复行为钉死：
   *      R1 空响应不落盘、页面明说失败（而不是安静地把「全部」显示成 0）
   *      R2 历史坏缓存（map:{}）读时判废 ⇒ 自动重新同步 ⇒ 数字自愈
   *      R3 全程请求 query 里不出现 "undefined"
   */
  console.log('\n--- R. 静默空响应 / 坏缓存自愈 ---')

  // R0：全局扫一遍真实请求 —— query 里不许出现 `=undefined`
  const undefUrls = Array.from(allReqUrls).filter((u) => /[?&][^=]+=undefined(&|$)/.test(u))
  assert('R0 全程请求 query 无 undefined（cleanParams 生效）', undefUrls.length === 0, undefUrls.slice(0, 3).join(' , ') || `${allReqUrls.size} 个请求已扫`)

  const rCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const rPage = await rCtx.newPage()
  const readMetaCache = () =>
    rPage.evaluate(() => {
      const raw = localStorage.getItem('yumu_game_platform_v2')
      if (!raw) return null
      let v = raw
      try { v = JSON.parse(raw) } catch (e) {}
      if (v && v.data !== undefined) v = v.data // uni-app H5 的 {type,data} 信封
      return {
        mapKeys: Object.keys((v && v.map) || {}).length,
        platforms: (v && v.platforms) || null,
        genreCount: Array.isArray(v && v.genres) ? v.genres.length : 0
      }
    })

  // —— 注入「空成功」的游戏元数据响应（只拦 size=100 那次，列表请求照常放行）——
  let emptyServed = 0
  await rPage.route('**/api/games**', (route) => {
    const u = route.request().url()
    if (/size=100/.test(u)) {
      emptyServed += 1
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 200, message: 'ok', data: { current: 1, size: 100, pages: 0, total: 0, records: [] } })
      })
    }
    return route.continue()
  })
  await rPage.goto(BASE + '/#/pages/games/games', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await new Promise((r) => setTimeout(r, 6000))
  const rWarn = await rPage.$$eval('.warn__text', (els) => els.map((e) => e.innerText.replace(/\s+/g, '')))
  const rTabs = await rPage.$$eval('.pf__btn', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
  const rAllTab = rTabs.find((t) => t.startsWith('全部')) || ''
  assert('R1a 空响应被拦下：界面明说筛选数据加载失败', rWarn.length >= 1, rWarn.join('|') || '无提示')
  assert(
    'R1b 「全部」不显示假的 0（宁可不显示数字）',
    emptyServed >= 1 && !/\b0\b/.test(rAllTab),
    `拦截=${emptyServed} 全部档=「${rAllTab}」`
  )
  const badCache = await readMetaCache()
  assert('R2 空结果绝不落盘（缓存里没有空 map）', !badCache || badCache.mapKeys > 0, JSON.stringify(badCache))
  await rPage.screenshot({ path: path.join(SHOTS, 'R1-empty-response.png') })

  // —— 注入历史坏缓存（空 map + platforms {'':0}，与真机那份形状一致）——
  await rPage.unroute('**/api/games**')
  await rPage.evaluate(async () => {
    const bad = { at: Date.now(), map: {}, genres: [], platforms: { '': 0 } }
    const uni = window.uni
    if (uni && uni.setStorageSync) uni.setStorageSync('yumu_game_platform_v2', bad)
    else localStorage.setItem('yumu_game_platform_v2', JSON.stringify({ type: 'object', data: bad }))
  })
  // ⚠️ 本段必须**整页重载**才能触发「读缓存 → 判废 → 重新同步」：query 一定要放在 `#` 之前。
  //    写错成 `#/pages/xxx?t=…` 只是 hash 变了，SPA 不会重新加载文档、onLoad 不会再跑，
  //    于是上一段的失败态原样留着 —— 症状就是「自愈断言假失败」（本脚本 2026-09-20 实测踩到）。
  await rPage.goto(BASE + '/?t=' + Date.now() + '#/pages/games/games', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await new Promise((r) => setTimeout(r, 7000))
  const healedTabs = await rPage.$$eval('.pf__btn', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
  const healed = {}
  healedTabs.forEach((t) => {
    const m = t.match(/^(\S+)\s*(\d+)?$/)
    if (m) healed[m[1]] = m[2] === undefined ? undefined : Number(m[2])
  })
  const healedPlat = ['多平台', 'PC', '主机', '手游'].filter((k) => !(healed[k] > 0))
  assert('R3a 坏缓存读时判废 → 自动重新同步（不再信任空 map）', healedPlat.length === 0, `档位=${JSON.stringify(healed)}`)
  assert('R3b 「全部」恢复为真实游戏总数', healed['全部'] === truth.games, `页面=${healed['全部']} 接口=${truth.games}`)
  const goodCache = await readMetaCache()
  assert('R3c 重新同步后写入的是完好的映射', !!goodCache && goodCache.mapKeys > 0, JSON.stringify(goodCache))
  // R3d：类型行已移除（类型改为搜索即达），改为断言**类型数据本身**随自愈恢复 ——
  //   自愈重写后的缓存里 genres 必须是一份非空清单（搜索框把类型名解析成 genre 就靠它）。
  assert(
    'R3d 类型清单随自愈一起恢复（缓存里 genres 非空）',
    !!goodCache && goodCache.genreCount >= 6,
    `genres=${goodCache ? goodCache.genreCount : 'null'}`
  )
  await rPage.screenshot({ path: path.join(SHOTS, 'R2-self-heal.png') })
  await rCtx.close()

  await browser.close()
  console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
  console.log(`截图目录：${SHOTS}`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('脚本异常：', e.message)
  process.exit(1)
})

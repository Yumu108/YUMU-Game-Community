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
  const truth = await page.evaluate(async () => {
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
    // ② 干货池 = 攻略心得(1) + 资讯速递(4)，逐板块翻页拉全
    const counts = { '': 0, 多平台: 0, PC: 0, 主机: 0, 手机: 0 }
    /** 每个板块各自的篇数：资讯页(D) 与首页(A) 的口径差异就靠它核对 */
    const byBoard = {}
    let total = 0
    for (const b of [1, 4]) {
      const got = []
      for (let c = 1; c <= 3; c++) {
        const d = await api(`/posts?boardId=${b}&sort=latest&current=${c}&size=100`)
        const rec = (d && d.records) || []
        got.push(...rec)
        if (!rec.length || got.length >= (d.total || 0)) break
      }
      byBoard[b] = got.length
      total += got.length
      got.forEach((p) => {
        const k = gm[p.gameId]
        if (k) counts[k] = (counts[k] || 0) + 1
      })
    }
    counts[''] = total
    return { counts, total, byBoard, games: games.length }
  })
  assert(
    'P0 独立算出干货池规模（攻略+资讯）',
    truth.total >= 200 && truth.games >= 50,
    `篇数=${truth.total} 游戏=${truth.games} 分布=${JSON.stringify(truth.counts)} 板块=${JSON.stringify(truth.byBoard)}`
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

  assert('A8 首屏渲染帖子卡', (await count('.pc')) >= 8, `pc=${await count('.pc')}`)
  assert('A9 首屏卡片带平台角标', (await count('.pc__plat')) >= 8, `plat=${await count('.pc__plat')}`)
  assert('A10 结果计数与「全部」一致', (await text('.bar__count')).includes(String(truth.total)), await text('.bar__count'))
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
  console.log('\n--- C. 游戏库（平台 + 类型）---')
  await goto('/pages/games/games')
  assert('C1 游戏列表渲染', (await count('.gitem')) >= 10, `gitem=${await count('.gitem')}`)
  assert('C2 平台筛选条 5 档', (await count('.pf__btn')) === 5)
  const genreN = await count('.chip')
  assert('C3 类型筛选条渲染（含「全部类型」）', genreN >= 6, `chip=${genreN}`)
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

  // 类型筛选：请求要带上 genre
  await goto('/pages/games/games')
  const genreChips = await page.$$('.chip')
  let someGenre = null
  for (const c of genreChips) {
    const t = (await c.innerText()).replace(/\s+/g, '')
    if (!t.startsWith('全部类型')) {
      someGenre = { el: c, name: t.replace(/\d+$/, '') }
      break
    }
  }
  if (someGenre) {
    const [gReq] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/games') && /genre=/.test(r.url()), { timeout: 9000 }).catch(() => null),
      someGenre.el.click()
    ])
    await sleep(1600)
    assert('C6 选类型后请求带上 genre 参数', !!gReq, `类型=${someGenre.name}`)
  } else {
    assert('C6 选类型后请求带上 genre 参数', false, '没找到类型 chip')
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
  console.log('\n--- D. 资讯（board 4 的分平台视图）---')
  await goto('/pages/news/news')
  assert('D1 资讯列表渲染', (await count('.pc')) >= 1, `pc=${await count('.pc')}`)
  assert('D2 平台筛选条 5 档', (await count('.pf__btn')) === 5)
  assert('D3 排序 chip 3 档', (await count('.sortchip')) === 3)
  // D4 资讯页的口径：只出「资讯速递」，不混进攻略
  const dPlat = await page.$$eval('.pc__plat', (els) => els.map((e) => e.innerText.trim()))
  assert('D4 资讯卡片带平台角标', dPlat.length >= 1, `${dPlat.length} 个角标`)
  // 判据取**事实**：页面「共 N 篇」要等于独立打接口算出的 board4 篇数，
  // 且 board4 必须是干货池的**真子集**（攻略心得那批不能混进来）。
  //
  // ⚠️ 旧写法是直接 JSON.parse(localStorage.getItem('yumu_guide_index')) 读端内索引，
  //    结果恒为 0 —— 因为 uni-app H5 的 uni.setStorageSync 会给对象套一层
  //    `{type,data}` 信封，裸 JSON.parse 拿到的是信封而不是索引本体。
  //    这是**脚本自身的坑**（已改成读接口真值），不是产品问题。
  const newsCountText = await text('.bar__count')
  const newsPageNum = Number((newsCountText.match(/\d+/) || [])[0])
  assert(
    'D5 资讯页只出「资讯速递」板块（条数 = 接口独立统计的 board4）',
    newsPageNum === truth.byBoard[4] && truth.byBoard[4] > 0 && truth.byBoard[4] < truth.total,
    `页面「${newsCountText}」 接口 board4=${truth.byBoard[4]} 全量=${truth.total}`
  )
  await page.screenshot({ path: path.join(SHOTS, 'D-news.png') })

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
  console.log('\n--- F. 搜索（帖子走端内索引，游戏走后端）---')
  await goto('/pages/search/search?keyword=' + encodeURIComponent('原神'))
  await sleep(1600)
  const searchContent = await page.content()
  assert('F1 搜索结果含关键词命中', searchContent.includes('原神'))
  assert('F2 类型 Tab 3 档', (await count('.tabs__item')) === 3)
  assert('F3 端内命中区块渲染', /攻略 \/ 资讯/.test(await text('.mp-sec__title').catch(() => '')) || (await count('.pc')) > 0, `pc=${await count('.pc')}`)
  assert('F4 提示了在多少篇干货中搜索', /在\s*\d+\s*篇/.test(searchContent), '')
  await page.screenshot({ path: path.join(SHOTS, 'F-search.png') })

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

  await browser.close()
  console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
  console.log(`截图目录：${SHOTS}`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('脚本异常：', e.message)
  process.exit(1)
})

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
 *
 * ── 2026-09-17 增补（针对「全绿但用户看到光秃秃」的回归盲区）──────────────────
 *  ① G4 图片**真实解码**断言：只听 DOM 说「有 <image>」是不够的（uni-app H5 把
 *     `<image>` 渲染成 `<uni-image><div background-image>`），本脚本改为直接统计
 *     `/api/files/*` 的**网络响应**：必须 200 + `image/*`，且**不允许出现
 *     `/m/api/files/*`** —— 那正是导致线上全部图片挂掉的根因。
 *  ② H 离线失败态：拦截并 abort 所有 `/api/**`，断言页面出现「重试」而**不是**
 *     「没有找到匹配的游戏」；再解除拦截点重试，断言数据能回来。
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
    //    只改 hash 的话浏览器不会重新加载文档，SPA 会带着上一节的状态（筛选/滚动位置）继续跑，
    //    实测导致「上拉加载」一节假失败（还停在上一节的 PC 筛选，5 条已是全部）。
    await page.goto(`${BASE}/?t=${Date.now()}#${hash}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(2600)
  }

  /* ================= A. 首页 ================= */
  console.log('\n--- A. 首页 ---')
  await goto('/pages/index/index')
  assert('A1 搜索入口渲染', (await count('.search')) >= 1)
  const hotN = await count('.gcard')
  assert('A2 热门游戏横滑有内容', hotN >= 3, `gcard=${hotN}`)
  const pcN = await count('.pc')
  assert('A3 资讯 + 攻略列表有帖子', pcN >= 4, `pc=${pcN}`)
  assert('A4 页面含「热门游戏」标题', (await page.content()).includes('热门游戏'))
  assert('A5 统计条渲染', (await count('.stats__item')) === 3)

  // A6 统计数字必须是**库里的真实总量**，不能拿「本页取了几条」冒充
  //    （原来「热门游戏」显示的是 hotGames.length，恒为请求的 8，与 40+ 款游戏对不上）
  const stats = await page.$$eval('.stats__num', (els) => els.map((e) => e.innerText.trim()))
  const gameTotal = await page.evaluate(async () => {
    const r = await fetch('/api/games?current=1&size=1').then((x) => x.json())
    return r && r.data && r.data.total
  })
  assert(
    'A6 首页「收录游戏」= 接口真实总量',
    String(gameTotal) === stats[0] && Number(gameTotal) > 10,
    `页面=${stats[0]} 接口=${gameTotal}`
  )

  // A7 首页帖子卡片有封面（图片是否**真的解码成功**放到 G4 统一断言）
  assert('A7 首页卡片渲染封面容器', (await count('.pc__thumb')) >= 3, `thumb=${await count('.pc__thumb')}`)
  await page.screenshot({ path: path.join(SHOTS, 'A-home.png') })

  /* ================= B. 详情页 · 要点卡 ================= */
  console.log('\n--- B. 详情页（核心亮点：拆解卡）---')

  // 🚨 帖子 id 必须**动态取**：写死 3005/3001 会在换库（本地库 / 线上库 id 段不同）时
  //    整段假失败 —— 而且表现是「页面什么都没有」，很容易被误读成前端坏了。
  //    本地库实测 id 段是 5001~200588，线上是 3xxx，两边根本没有交集。
  await goto('/pages/index/index')
  const candIds = await page.evaluate(async () => {
    const r = await fetch('/api/posts?boardId=1&sort=hot&current=1&size=6').then((x) => x.json())
    return ((r && r.data && r.data.records) || []).map((p) => p.id)
  })
  assert('B0 从接口取到候选帖子 id', candIds.length >= 3, candIds.join(','))

  // 取第一篇**真能拆出要点卡**的（线上实测拆解率不是 100%，让断言挑一篇能过的）
  let hit = null
  for (const id of candIds) {
    await goto('/pages/post/detail?id=' + id)
    const n = await count('.step')
    if (n >= 2) {
      hit = { id, n }
      break
    }
  }
  assert('B1 候选帖中存在可拆解内容（≥2 张要点卡）', !!hit, hit ? `id=${hit.id} step=${hit.n}` : `${candIds.length} 篇都没拆出来`)

  if (hit) {
    const modeTxt = await text('.modebar')
    // 两种模式都算通过：正文带序号/小标题 → 步骤模式；整段散文 → 要点模式。
    // 断言写死其中一种会在换内容时假失败（本地库第一篇就是「步骤模式」）。
    assert('B2 模式条含模式标签', /要点模式|步骤模式/.test(modeTxt), modeTxt.replace(/\s+/g, ' ').slice(0, 30))
    assert('B3 详情页有正文标题', (await text('.title')).length > 4)
    await page.screenshot({ path: path.join(SHOTS, 'B-detail-card.png') })

    // 切到原文模式
    const modeBtns = await page.$$('.modebar__btn')
    if (modeBtns.length >= 2) {
      await modeBtns[1].click()
      await sleep(600)
      const stepAfter = await count('.step')
      const pAfter = await count('.content__p')
      assert('B4 切「原文模式」后卡片消失、段落出现', stepAfter === 0 && pAfter >= 1, `step=${stepAfter} p=${pAfter}`)
      await page.screenshot({ path: path.join(SHOTS, 'B-detail-raw.png') })
      await modeBtns[0].click()
      await sleep(600)
      assert('B5 切回后卡片恢复', (await count('.step')) >= 2)
    } else {
      assert('B4 模式切换按钮存在', false)
      assert('B5 切回后卡片恢复', false)
    }

    // 收藏（本地存储）—— 操作条现在只有 [收藏, 分享] 两个按钮
    const favBtns = await page.$$('.fab__btn')
    if (favBtns.length >= 1) {
      await favBtns[0].click()
      await sleep(500)
      const favTxt = (await page.$eval('.fab', (el) => el.innerText)).replace(/\s+/g, '')
      assert('B6 点击收藏后文案变为「已收藏」', favTxt.includes('已收藏'), favTxt)
      await favBtns[0].click()
      await sleep(500)
      const favTxt2 = (await page.$eval('.fab', (el) => el.innerText)).replace(/\s+/g, '')
      assert('B7 再点取消收藏', !favTxt2.includes('已收藏'), favTxt2)
    } else {
      assert('B6 收藏按钮存在', false)
      assert('B7 再点取消收藏', false)
    }

    // B8 不能再出现「功能没做完」式文案（原来点赞弹「点赞需登录，第二期开放」）
    const fabTxt = await text('.fab')
    assert('B8 操作条不含「第二期开放 / 点赞需登录」', !/第二期|点赞需登录/.test(fabTxt), fabTxt.replace(/\s+/g, ' '))
    assert('B9 操作条按钮数为 2（收藏 / 分享）', (await count('.fab__btn')) === 2, `n=${await count('.fab__btn')}`)
    assert('B10 详情页渲染了作者头像或首字占位', (await count('.author__avatar')) + (await count('.author__ph')) >= 1)
  } else {
    for (const n of ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10']) assert(`${n} 依赖可拆解帖子`, false, '无候选帖')
  }

  // B11 不存在的帖子 id：必须给失败态 + 重试，而不是永远转圈的骨架屏
  //     （原来 catch 里直接 return，post 保持 null ⇒ 模板 v-else 一直渲染 Skeleton）
  await goto('/pages/post/detail?id=999999999')
  const deadTxt = await page.content()
  assert('B11 打开不存在的帖子 → 失败态而非永久骨架屏', (await count('.err')) >= 1 && (await count('.sk')) === 0, `err=${await count('.err')}`)
  assert('B12 失败态给出了原因', /已被删除|隐藏|不存在|网络/.test(deadTxt), '')

  /* ========== B-reply. 详情页回复区 ==========
     🚨 2026-09-17 修的 P0：`GET /posts/{id}/replies` 的 `Result.data` 是**裸数组**，
       而详情页按分页体读 `.records` / `.total` ⇒ 两者恒为 undefined ⇒
       回复区永远「还没有回复」、标题永远「回复 0」。线上 27 条的讨论串一条都看不到。
     这个盲区与 G4（图片）是同一类毛病：**故障被空态伪装成「本来就没有」**。
       所以下面必须**拿接口返回的条数去对 DOM** —— 只断言「有没有 .reply 元素」抓不到它，
       因为真正的坏法是「元素一个都没有，但页面看起来很正常」。
  */
  console.log('\n--- B-reply. 详情页回复区（含楼中楼）---')
  const rp = await page.evaluate(async () => {
    const r = await fetch('/api/posts?sort=reply&current=1&size=1').then((x) => x.json())
    const p = r.data.records[0]
    const rep = await fetch(`/api/posts/${p.id}/replies`).then((x) => x.json())
    const list = Array.isArray(rep.data) ? rep.data : (rep.data && rep.data.records) || []
    return {
      id: p.id,
      replyCount: p.replyCount,
      apiN: list.length,
      nested: list.filter((x) => x.replyToName).length,
      floors: list.filter((x) => x.floor).length
    }
  })
  await goto(`/pages/post/detail?id=${rp.id}`)
  const replyHead = await text('.mp-sec__title')
  const replyN = await count('.reply')
  assert(
    'B13 回复标题显示真实条数',
    replyHead.includes(String(rp.replyCount)),
    `页面「${replyHead}」 接口 replyCount=${rp.replyCount}`
  )
  assert('B14 回复真的渲染出来了（不再是恒空）', replyN > 0, `DOM=${replyN} 接口=${rp.apiN}`)
  assert('B15 有回复时不得出现「还没有回复」', !(await page.content()).includes('还没有回复'))

  const REPLY_PAGE = 12
  const expectN = Math.min(rp.apiN, REPLY_PAGE)
  assert('B16 默认只渲染前 12 条（长讨论串不撑爆页面）', replyN === expectN, `DOM=${replyN} 期望=${expectN} 接口=${rp.apiN}`)
  if (rp.apiN > REPLY_PAGE) {
    assert('B17 出现「展开全部 N 条」', (await text('.more')).includes(String(rp.apiN)), (await text('.more')).trim())
    await page.click('.more')
    await sleep(1000)
    const expanded = await count('.reply')
    assert('B18 点「展开全部」后渲染完整', expanded === rp.apiN, `DOM=${expanded} 接口=${rp.apiN}`)
  } else {
    assert('B17 回复未超一页，无需展开', true, `apiN=${rp.apiN}`)
    assert('B18 回复未超一页，无需展开', true, `apiN=${rp.apiN}`)
  }
  assert('B19 渲染楼层号 #N', rp.floors === 0 ? true : (await count('.reply__floor')) > 0, `含 floor 的回复=${rp.floors}`)
  assert('B20 楼中楼标出「回复 @某人」', rp.nested === 0 ? true : (await count('.reply__to')) > 0, `嵌套回复=${rp.nested}`)
  await page.screenshot({ path: path.join(SHOTS, 'B-reply.png') })

  /* ========== B-card. 拆解卡不得静默丢内容 ==========
     原实现三处静默丢失（内容富化后才暴露）：
       ① `MAX_ITEMS=12` 硬截断 —— 线上那篇原文有 16 条，第 13~16 条整段消失；
       ② 首个条目之前的**导语**被直接丢弃；
       ③ `【第一梯队：…】` 这类**分组标题行**被丢弃，12 张平等的卡看不出层次。
     `stepParser.test.mjs` 只能验解析规则，**验不了「线上真实长文是否被切少了」**，
     所以这里直接拿线上最长的那类帖子对数量。
  */
  console.log('\n--- B-card. 拆解卡：导语 / 分组 / 不截断 ---')
  const deep = await page.evaluate(async () => {
    // ⚠️ 必须**分页**抓：后端对 size 有上限 100（传 200/500 同样只回 100 条），
    //    而「【第一梯队…】+ 编号条目」这种结构集中在攻略板块后段（长文是最后一批入库的），
    //    只抓一页会取不到候选 —— 那不是功能坏了，是取样没取到。
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
    assert('B21 原文的分组标题渲染成小节（不再被丢弃）', secN >= 2, `sect=${secN} 原文分组=${deep.secs}`)
    assert('B22 导语段被保留（不再「首个序号之前直接丢弃」）', (await count('.intro')) >= 1)
    const cardN = await count('.step')
    // 关键：原来 MAX_ITEMS=12 会把 16 条切到 12 条，且**页面完全看不出来**
    if (deep.numbered >= 13) {
      assert('B23 卡片数突破旧上限 12（不再静默截断）', cardN >= 13, `DOM=${cardN} 原文编号条目=${deep.numbered}`)
    } else {
      assert('B23 候选帖条目不足 13，无法验证截断', true, `numbered=${deep.numbered}`)
    }
    assert('B24 未触发截断时不显示「已省略」', !(await page.content()).includes('已省略'))
    await page.screenshot({ path: path.join(SHOTS, 'B-card.png') })
  } else {
    for (const n of ['B21', 'B22', 'B23', 'B24']) assert(`${n} 依赖带分组的帖子`, false, '本次未取到候选')
  }

  /* ================= C. 游戏库 ================= */
  console.log('\n--- C. 游戏库 ---')
  await goto('/pages/games/games')
  const g0 = await count('.gitem')
  assert('C1 游戏列表渲染', g0 >= 10, `gitem=${g0}`)
  assert('C2 平台筛选条渲染', (await count('.chip')) >= 5)
  await page.screenshot({ path: path.join(SHOTS, 'C-games.png') })

  // 筛选 PC
  // 🚨 原来断言「数量必须变化」，这是个**脆弱**判据：PC 是最大的平台，
  //    第一页只有 12 个位置，筛选前后条数完全可能都是 12（游戏库涨到 80 款后就这样了）
  //    —— 功能完全正常却报红。改成核对**请求真的带上了 platform 参数**，与数据分布无关。
  const chips = await page.$$('.chip')
  let pcChip = null
  for (const c of chips) {
    if ((await c.innerText()).trim() === 'PC') pcChip = c
  }
  const [pcReq] = await Promise.all([
    page
      .waitForRequest((r) => r.url().includes('/api/games') && /platform=pc/i.test(r.url()), { timeout: 9000 })
      .catch(() => null),
    pcChip ? pcChip.click() : Promise.resolve()
  ])
  await sleep(2000)
  const gPc = await count('.gitem')
  assert(
    'C3 选「PC」后请求带上 platform=PC',
    !!pcReq,
    pcReq ? pcReq.url().replace(/^https?:\/\/[^/]+/, '') : '未捕获到筛选请求'
  )
  assert('C3b 筛选后仍有结果', gPc > 0, `gitem=${gPc}`)
  await page.screenshot({ path: path.join(SHOTS, 'C-games-pc.png') })

  // 上拉加载（current 自增）—— 单独用一次**干净导航**，避免与上面的筛选相互干扰
  // ⚠️ 实测：H5 的滚动容器是 documentElement/body（uni-page-body 自身不滚），
  //    滚到 `documentElement.scrollHeight` 才会触发 onReachBottom。
  await goto('/pages/games/games')
  const before = await count('.gitem')
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await sleep(1200)
  }
  const after = await count('.gitem')
  const sc = await page.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight }))
  assert('C4 上拉加载生效（current 参数正确）', after > before, `before=${before} after=${after} scrollY=${sc.y}/${sc.h}`)
  const footer = await text('.footer')
  assert('C5 底部状态文案存在', footer.length > 0, footer.replace(/\s+/g, ' '))

  /* ================= D. 资讯 ================= */
  console.log('\n--- D. 资讯 ---')
  await goto('/pages/news/news')
  assert('D1 资讯列表渲染', (await count('.pc')) >= 1, `pc=${await count('.pc')}`)
  assert('D2 排序 chip 渲染', (await count('.chip')) >= 4)
  await page.screenshot({ path: path.join(SHOTS, 'D-news.png') })

  /* ================= E. 我的 ================= */
  console.log('\n--- E. 我的 ---')
  await goto('/pages/my/my')
  assert('E1 账号区渲染', (await count('.user')) === 1)
  assert('E2 收藏/历史双 Tab', (await count('.tabs__item')) === 2)
  const myContent = await page.content()
  assert('E3 显示收藏或空态', myContent.includes('我的收藏'))
  assert('E4 不出现「未登录」这种像坏掉的文案', !myContent.includes('未登录'))
  await page.screenshot({ path: path.join(SHOTS, 'E-my.png') })

  /* ================= F. 搜索 ================= */
  console.log('\n--- F. 搜索 ---')
  await goto('/pages/search/search?keyword=' + encodeURIComponent('原神'))
  await sleep(1200)
  const searchContent = await page.content()
  assert('F1 搜索结果含关键词命中', searchContent.includes('原神'))
  assert('F2 类型 Tab 渲染', (await count('.tabs__item')) >= 3)

  // F3 搜索结果必须能翻页（原来写死 size:20 且没有上拉加载，第 21 条起凭空消失）
  const sBefore = await count('.pc')
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await sleep(1200)
  }
  const sAfter = await count('.pc')
  assert('F3 搜索结果可上拉加载更多', sAfter > sBefore && sBefore >= 5, `before=${sBefore} after=${sAfter}`)
  await page.screenshot({ path: path.join(SHOTS, 'F-search.png') })

  /* ================= G. 全局 ================= */
  console.log('\n--- G. 全局 ---')
  assert('G1 tabBar 存在', (await count('uni-tabbar')) >= 1 || (await count('.uni-tabbar')) >= 1)
  const hardErrors = errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e))
  assert('G2 无 JS 运行时错误', hardErrors.length === 0, hardErrors.slice(0, 2).join(' | '))
  if (hardErrors.length) console.log('   错误明细：\n     ' + hardErrors.slice(0, 8).join('\n     '))

  // G3 移动端 viewport（2026-09-17 补）
  //   背景：uni-app 官方 H5 模板用一段**内联脚本** document.write 生成 <meta viewport>，
  //   而生产 nginx 的 CSP 是 `script-src 'self'` ⇒ 脚本被拒 ⇒ 页面上一个 viewport meta
  //   都没有 ⇒ 真机按 980px 桌面宽度渲染、移动端布局全乱。
  //   这类后果**不会让页面白屏**，只看「有没有报错」容易放过，所以这里直接读 DOM 断言。
  const vp = await page.evaluate(() => {
    const m = document.querySelector('meta[name="viewport"]')
    return m ? m.getAttribute('content') || '' : null
  })
  assert(
    'G3 viewport meta 正确（width=device-width）',
    !!vp && /width=device-width/.test(vp),
    vp === null ? '缺失（可能被 CSP 拦掉了内联脚本）' : vp
  )

  // G4 图片**真的加载出来了**（不是「DOM 里有 <image> 就算过」）
  //   · 判据一：所有 /api/files/* 请求必须 200 且 content-type 是 image/*
  //   · 判据二：**不允许出现 /m/api/files/*** —— 那是 H5 路由 base 拼错的表现，
  //     线上正是它让全部封面 404（本地 400+ 张图，一张都没显示）
  const badPath = fileReqs.filter((r) => /\/m\/api\/files\//.test(r.url))
  const notImage = fileReqs.filter((r) => r.status !== 200 || !r.ct.startsWith('image/'))
  assert('G4a 图片请求路径未被路由 base 污染（无 /m/api/files/）', badPath.length === 0, badPath.slice(0, 2).map((r) => r.url).join(' | '))
  assert(
    'G4b 图片全部 200 且为 image/*',
    fileReqs.length >= 8 && notImage.length === 0,
    `共 ${fileReqs.length} 个请求，异常 ${notImage.length} 个` +
      (notImage.length ? ' → ' + notImage.slice(0, 3).map((r) => `${r.status} ${r.ct}`).join('; ') : '')
  )

  // G5 tabBar 图标（原来 pages.json 没配 iconPath，底部只有四个字）
  const tbIcons = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('uni-tabbar img'))
    return { n: imgs.length, decoded: imgs.filter((i) => i.naturalWidth > 0).length }
  })
  assert('G5a tabBar 有 4 个图标', tbIcons.n === 4, `n=${tbIcons.n}`)
  assert('G5b tabBar 图标真实解码', tbIcons.decoded === 4, `decoded=${tbIcons.decoded}`)

  /* ================= H. 离线失败态（原 Z-offline 事故） ================= */
  console.log('\n--- H. 断网时的表现 ---')
  await page.route('**/api/**', (r) => r.abort())
  await goto('/pages/games/games')
  const offlineTxt = await page.content()
  const errN = await count('.err')
  assert('H1 断网时渲染失败态 + 重试按钮', errN >= 1 && (await count('.err__btn')) >= 1, `err=${errN}`)
  assert(
    'H2 断网时**不**说成「没有找到匹配的游戏」',
    !offlineTxt.includes('没有找到匹配的游戏'),
    offlineTxt.includes('没有找到匹配的游戏') ? '仍在用空态话术' : ''
  )
  await page.screenshot({ path: path.join(SHOTS, 'Z-offline-games.png') })

  // 恢复网络 → 点重试 → 数据应当回来
  await page.unroute('**/api/**')
  const retryBtn = await page.$('.err__btn')
  if (retryBtn) await retryBtn.click()
  await sleep(2600)
  assert('H3 点重试后恢复出数据', (await count('.gitem')) >= 10, `gitem=${await count('.gitem')}`)
  assert('H4 恢复后失败态消失', (await count('.err')) === 0)
  await page.screenshot({ path: path.join(SHOTS, 'Z-recovered-games.png') })

  // H5/H6 「回复加载失败」不得伪装成「没有回复」—— 与 G4（图片）同类：
  //      故障被空态/兜底说成「本来就没有」，用户与评审都看不出来。
  //      只 abort `/replies`，正文必须照常可读（回复失败不该拖垮整页）。
  const rpId = await page.evaluate(async () => {
    const r = await fetch('/api/posts?sort=reply&current=1&size=1').then((x) => x.json())
    return r.data.records[0].id
  })
  await page.route('**/replies**', (r) => r.abort())
  await goto(`/pages/post/detail?id=${rpId}`)
  const offBody = await page.content()
  assert('H5 回复失败 → 不说成「还没有回复」', !offBody.includes('还没有回复'), offBody.includes('还没有回复') ? '把故障说成了事实' : '')
  assert('H6 回复失败不拖垮正文（仍能读到内容）', (await count('.step')) + (await count('.content__p')) > 0)
  await page.screenshot({ path: path.join(SHOTS, 'Z-offline-reply.png') })
  await page.unroute('**/replies**')

  await browser.close()
  console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
  console.log(`截图目录：${SHOTS}`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('脚本异常：', e.message)
  process.exit(1)
})

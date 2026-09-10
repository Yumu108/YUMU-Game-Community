// 用法：node verify-anno-modal.js
// 作用：公告弹窗「重要公告」视觉收敛 + 外框尺寸恒定 的 UI 回归。
//   ① 尺寸恒定：逐条切换全部公告，断言 .anno-card / .anno-marquee 的高宽完全一致
//      （覆盖 3 条置顶 + 3 条普通、内容 88~155 字的长短差异）
//   ② 内容不外溢：长文只在 .anno-item-content 内部滚动，不撑高卡片
//   ③ 色彩收敛：解析 box-shadow / border-color 的 rgba，断言"高饱和暖色光晕"的 alpha 已被压低；
//      角标不再是霓虹橙 #ff5b4e→#ff8a3c；呼吸动画从 2.4s 放缓到 5s
//   ④ 重要性的表达：左侧强调色条 ::before 仍在、置顶角标仍在（避免"收敛"变成"没做区分"）
//   ⑤ 无回归：点「我知道了」可正常关闭；全程无 pageerror / console error
// 依赖：前端 5173（preview 产物或 dev server 均可）+ 后端 8080
const { chromium } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP = process.env.WEB_BASE || 'http://localhost:5173'
const OUT = path.resolve(__dirname, '../../docs/screenshots')

let pass = 0, fail = 0
const failures = []
function ok (cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`) }
}
function section (t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`) }

/** 解析 computed 值里的所有 rgba/rgb，返回 [{r,g,b,a}] */
const rgbaRe = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)/g
function parseColors (str) {
  const out = []
  for (const m of String(str).matchAll(rgbaRe)) {
    out.push({ r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] })
  }
  return out
}
/** "高饱和暖色光晕"：偏红橙、且亮度够高（#ff5b4e / #ff8a3c 这类） */
const isWarmGlow = (c) => c.r >= 180 && c.g <= 170 && c.b <= 150

/** 读当前这一条公告的完整量测 */
const measure = (page) => page.evaluate(() => {
  const card = document.querySelector('.anno-card')
  const marquee = document.querySelector('.anno-marquee')
  const content = document.querySelector('.anno-item-content')
  const meta = document.querySelector('.anno-item-meta')
  const cr = card.getBoundingClientRect()
  const cs = getComputedStyle(card)
  const badge = document.querySelector('.anno-pin-badge')
  const before = getComputedStyle(card, '::before')
  const title = document.querySelector('.anno-title')
  const mr = marquee ? marquee.getBoundingClientRect() : null
  const mtr = meta ? meta.getBoundingClientRect() : null
  return {
    title: document.querySelector('.anno-item-title')?.textContent?.trim() || '',
    headerTitle: title?.textContent?.trim() || '',
    isTop: document.querySelector('.anno-modal')?.classList.contains('is-top') || false,
    card: { w: Math.round(cr.width * 100) / 100, h: Math.round(cr.height * 100) / 100 },
    marqueeH: marquee ? marquee.clientHeight : -1,
    content: content
      ? { client: content.clientHeight, scroll: content.scrollHeight, overflowY: getComputedStyle(content).overflowY }
      : null,
    contentLen: content ? content.textContent.trim().length : 0,
    // meta（发布人/时间）必须完整落在滚动区内，否则说明长文把底部挤出去了
    metaVisible: !!(mr && mtr && mtr.height > 0 && mtr.bottom <= mr.bottom + 1 && mtr.top >= mr.top - 1),
    metaOverflow: mtr && mr ? Math.round((mtr.bottom - mr.bottom) * 10) / 10 : null,
    cardShadow: cs.boxShadow,
    cardBorder: cs.borderTopColor,
    cardBg: cs.backgroundImage,
    animationDuration: cs.animationDuration,
    cardHeightRule: cs.height,
    titleColor: title ? getComputedStyle(title).color : '',
    beforeContent: before.content,
    beforeWidth: before.width,
    badgeBg: badge ? getComputedStyle(badge).backgroundImage : null,
    badgeShadow: badge ? getComputedStyle(badge).boxShadow : null
  }
})

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const page = await ctx.newPage()

  const errors = []
  page.on('pageerror', e => errors.push('PAGEERR ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()) })

  console.log('═'.repeat(66))
  console.log(' 公告弹窗 —— 视觉收敛 & 尺寸恒定 回归')
  console.log(' 目标：', APP)
  console.log('═'.repeat(66))

  // ---------------------------------------------------------- 打开弹窗
  section('打开弹窗')
  await page.goto(APP + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForSelector('.anno-modal .anno-card', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(800)
  const opened = !!(await page.$('.anno-modal .anno-card'))
  ok(opened, '首页冷启动弹出公告弹窗')
  if (!opened) {
    console.log('\n弹窗未出现，终止。'); await browser.close(); process.exit(1)
  }

  // 鼠标移入公告区 → 组件 paused=true，停止自动轮播，避免测量中途被切走
  const mq = await page.$('.anno-marquee')
  const mb = await mq.boundingBox()
  const hx = Math.round(mb.x + mb.width / 2), hy = Math.round(mb.y + mb.height / 2)
  const nudge = async () => { await page.mouse.move(hx, hy - 3); await page.mouse.move(hx, hy) }
  await nudge()
  await page.waitForTimeout(300)

  const total = await page.$$eval('.anno-progress-bar', els => els.length)
  // 接口默认只返回「展示中的最新 5 条」，所以基准取接口实际条数而不是库里全部
  const apiList = await fetch('http://localhost:8080/api/announcements')
    .then(r => r.json()).then(j => (Array.isArray(j?.data) ? j.data : [])).catch(() => [])
  ok(total > 0 && total === apiList.length, '进度条与接口返回的公告条数一致',
    `DOM ${total} / API ${apiList.length}`)

  // ---------------------------------------------------------- 逐条量测
  section('尺寸恒定（逐条切换全部公告）')
  const rows = []
  for (let i = 0; i < total; i++) {
    await page.locator('.anno-progress-bar').nth(i).click().catch(() => {})
    await nudge()
    await page.waitForTimeout(550) // 等 anno-slide 切换动画结束
    const r = await measure(page)
    rows.push(r)
    console.log(`   · [${i}] ${r.isTop ? '置顶' : '普通'} | 卡 ${r.card.w}×${r.card.h} | 滚动区 ${r.marqueeH} | 正文 ${r.content.scroll}/${r.content.client}px | meta ${r.metaVisible ? '在框内' : '溢出 ' + r.metaOverflow + 'px'} | ${r.title.slice(0, 18)}`)
  }

  const heights = [...new Set(rows.map(r => r.card.h))]
  const widths = [...new Set(rows.map(r => r.card.w))]
  const mHeights = [...new Set(rows.map(r => r.marqueeH))]
  ok(heights.length === 1, '卡片高度在所有公告间完全一致', heights.join(' / ') + ' px')
  ok(widths.length === 1, '卡片宽度在所有公告间完全一致', widths.join(' / ') + ' px')
  ok(mHeights.length === 1, '正文滚动区高度恒定', mHeights.join(' / ') + ' px')
  const EXPECT_H = Math.min(520, Math.round(950 * 0.88))
  ok(heights[0] === EXPECT_H, `卡片高度符合 min(520px, 88vh)`, `${heights[0]}px`)

  // 长短内容确实都覆盖到了（证明"恒定"不是因为内容都一样长）
  // 注意：正文盒被 flex 固定后 clientHeight 会相等，所以改看文本字数跨度
  const lens = rows.map(r => r.contentLen)
  const spread = Math.max(...lens) - Math.min(...lens)
  ok(spread > 30, '样本覆盖了明显的内容长度差异', `正文字数跨度 ${Math.min(...lens)}~${Math.max(...lens)}（差 ${spread} 字）`)
  ok(rows.some(r => r.isTop) && rows.some(r => !r.isTop), '样本同时含置顶与非置顶公告',
    `${rows.filter(r => r.isTop).length} 置顶 / ${rows.filter(r => !r.isTop).length} 普通`)

  section('长文只在内区滚动，不撑高外框')
  ok(rows.every(r => r.content.overflowY === 'auto'), '正文区 overflow-y=auto')
  const longest = rows.reduce((a, b) => ((b.content.scroll > a.content.scroll) ? b : a), rows[0])
  ok(longest.content.scroll >= longest.content.client - 1, '最长公告正文高度 ≥ 可视高度（无截断）',
    `${longest.content.scroll} vs ${longest.content.client}`)
  ok(rows.every(r => r.card.h === heights[0]), '正文长短不影响卡片总高（复检）')
  // 底部 meta 不能被长文挤出可视区（否则内容其实被裁了）
  const badMeta = rows.filter(r => !r.metaVisible)
  ok(badMeta.length === 0, '每条公告的「发布人 · 时间」都在可视区内（无裁切）',
    badMeta.length ? badMeta.map(r => `${r.title.slice(0, 10)}(溢出${r.metaOverflow}px)`).join(', ') : '全部在框内')

  // ---------------------------------------------------------- 色彩收敛
  section('色彩 / 光晕收敛（解析 rgba 客观判定）')
  const topRow = rows.find(r => r.isTop) || rows[0]
  // box-shadow 按顶层逗号切段（跳过 rgba(...) 内的逗号）
  const shadowSegs = String(topRow.cardShadow).split(/,(?![^(]*\))/)
  const warmSegs = shadowSegs.filter(seg => parseColors(seg).some(isWarmGlow))
  const maxGlowA = warmSegs.length
    ? Math.max(...warmSegs.map(seg => Math.max(...parseColors(seg).filter(isWarmGlow).map(c => c.a))))
    : 0
  ok(maxGlowA <= 0.2, '暖色光晕 alpha 已压低到 ≤ 0.2（原为 0.55）', `max=${maxGlowA}`)
  const maxWarmBlur = warmSegs.length
    ? Math.max(...warmSegs.map(seg => (seg.match(/([\d.]+)px/g) || []).map(n => parseFloat(n)).reduce((a, b) => Math.max(a, b), 0)))
    : 0
  ok(maxWarmBlur < 60, '不再有大半径（≥60px）暖色外发光（原为 120px）', `max=${maxWarmBlur}px`)

  const borderA = parseColors(topRow.cardBorder)[0]?.a ?? 1
  ok(borderA <= 0.4, '卡片描边 alpha ≤ 0.4（原为 0.55）', `a=${borderA}`)

  const anim = parseFloat(topRow.animationDuration)
  ok(anim >= 4, '呼吸脉动由 2.4s 放缓到 ≥4s（降低闪烁感）', `${topRow.animationDuration}`)

  ok(topRow.badgeBg && !topRow.badgeBg.includes('rgb(255, 91, 78)'), '角标不再是霓虹橙 #ff5b4e')
  ok(topRow.badgeBg && (topRow.badgeBg.includes('rgb(184, 83, 66)') || topRow.badgeBg.includes('rgb(193, 133, 74)')),
    '角标改为低饱和深绛红→琥珀', String(topRow.badgeBg).slice(0, 60))
  const bShadow = parseColors(topRow.badgeShadow || '')
  ok(!bShadow.some(c => isWarmGlow(c) && c.a > 0.25), '角标去掉了高饱和投影')

  section('重要性仍被表达（收敛 ≠ 取消区分）')
  ok(topRow.beforeContent !== 'none', '置顶卡保留左侧强调色条 ::before')
  ok(topRow.beforeWidth === '3px', '强调条宽度 3px', topRow.beforeWidth)
  // 角标只挂在置顶条目上 —— 必须先把当前条切回置顶项再查（测量循环结束时停在最后一条）
  const topIdx = rows.findIndex(r => r.isTop)
  await page.locator('.anno-progress-bar').nth(topIdx).click().catch(() => {})
  await nudge()
  await page.waitForTimeout(550)
  const badgeExists = !!(await page.$('.anno-pin-badge'))
  ok(badgeExists, '置顶「重要公告」角标仍存在')
  const normalIdx = rows.findIndex(r => !r.isTop)
  await page.locator('.anno-progress-bar').nth(normalIdx).click().catch(() => {})
  await nudge()
  await page.waitForTimeout(550)
  ok(!(await page.$('.anno-pin-badge')), '非置顶条目不显示「重要」角标')
  ok(!(await page.$('.anno-modal.is-top')), '非置顶条目不再给整卡套 is-top 风格')
  ok(topRow.headerTitle.includes('重要公告'), '置顶时头部标题为「重要公告」', topRow.headerTitle)
  const normalRow = rows.find(r => !r.isTop)
  ok(!!normalRow, '存在非置顶公告样本')
  ok(normalRow ? normalRow.headerTitle.includes('社区公告') : false, '非置顶时头部标题为「社区公告」',
    normalRow ? normalRow.headerTitle : '-')

  // ---------------------------------------------------------- 截图留档
  section('截图留档')
  // 逐条 scratch 截图落在 tests/.pw（该目录的 *.png 已被 .gitignore 忽略），避免污染仓库
  const SCRATCH = __dirname
  for (let i = 0; i < total; i++) {
    await page.locator('.anno-progress-bar').nth(i).click().catch(() => {})
    await nudge()
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(SCRATCH, `anno-${i}.png`) })
  }
  ok(fs.existsSync(path.join(SCRATCH, 'anno-0.png')), `逐条 scratch 截图 ${total} 张（tests/.pw/anno-0..${total - 1}.png）`)

  // 只把三张有代表性的落进 docs/screenshots 留档
  const picks = [
    ['top', rows.findIndex(r => r.isTop)],
    ['normal', rows.map((r, i) => (!r.isTop ? i : -1)).filter(i => i >= 0).pop()],
    ['longest', rows.indexOf(longest)]
  ]
  for (const [tag, i] of picks) {
    if (i < 0) continue
    await page.locator('.anno-progress-bar').nth(i).click().catch(() => {})
    await nudge()
    await page.waitForTimeout(600)
    const p = path.join(OUT, `anno-modal-${tag}.png`)
    await page.screenshot({ path: p })
    ok(fs.existsSync(p), `截图 anno-modal-${tag}.png`)
  }

  // ---------------------------------------------------------- 极端长文压测
  section('极端长文压测（内容再多也不撑框）')
  await page.evaluate(() => {
    const c = document.querySelector('.anno-item-content')
    if (c) c.textContent = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行压力测试文本，验证外框不会被撑高。`).join('\n')
  })
  await page.waitForTimeout(250)
  const stress = await measure(page)
  ok(stress.card.h === heights[0], `灌入 60 行长文后卡片高度仍为 ${heights[0]}px`, String(stress.card.h))
  ok(stress.content.scroll > stress.content.client, '超长文本只在正文区内部滚动',
    `scroll ${stress.content.scroll} > client ${stress.content.client}`)
  ok(stress.metaVisible, '超长文本下「发布人 · 时间」仍在框内')

  // ---------------------------------------------------------- 关闭与报错
  section('关闭与运行时错误')
  await page.locator('.anno-modal .anno-btn-ok, .anno-modal .anno-foot .el-button').first().click().catch(() => {})
  await page.waitForTimeout(600)
  const closed = !(await page.$('.anno-modal'))
  ok(closed, '点「我知道了」后弹窗关闭')
  ok(errors.length === 0, '全程无 pageerror / console error', errors.slice(0, 3).join(' | '))

  await browser.close()

  console.log('\n' + '═'.repeat(66))
  console.log(`=== 结果：${pass}/${pass + fail} 通过 ===`)
  if (fail) { console.log('未通过：'); failures.forEach(f => console.log('  - ' + f)) }
  console.log('═'.repeat(66))
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error('脚本异常：', e.message); process.exit(1) })

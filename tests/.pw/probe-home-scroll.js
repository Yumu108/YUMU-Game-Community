// 一次性探针：量化首页「中间区域」的横向溢出 / 横滑来源
// 目的：确认用户截图里那条横向滚动条属于哪个容器，以及热门游戏 chip 一行放不下多少
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP = process.env.WEB_BASE || 'http://localhost:5173'

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  for (const w of [1366, 1440, 1920]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } })
    page.on('pageerror', e => console.log('PAGEERR', e.message))
    await page.goto(APP + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
    // 关掉公告弹窗，免得遮罩挡住量测
    await page.waitForSelector('.anno-modal', { timeout: 12000 }).catch(() => {})
    await page.evaluate(() => {
      document.querySelector('.anno-modal .anno-close')?.click()
      document.querySelector('.anno-modal')?.remove()
    })
    await page.waitForSelector('.quick-scroll', { timeout: 12000 }).catch(() => {})
    await page.waitForTimeout(800)

    const r = await page.evaluate(() => {
      const q = (s) => document.querySelector(s)
      const box = (el) => el ? { cw: el.clientWidth, sw: el.scrollWidth, ow: el.offsetWidth } : null
      // 找出所有横向溢出元素（scrollWidth 超出 clientWidth 1px 以上）
      const over = []
      document.querySelectorAll('*').forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          const cs = getComputedStyle(el)
          over.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 46),
            cw: el.clientWidth,
            sw: el.scrollWidth,
            ox: cs.overflowX,
            oy: cs.overflowY,
            diff: el.scrollWidth - el.clientWidth
          })
        }
      })
      const chips = [...document.querySelectorAll('.quick-scroll .quick-chip')].map((c) => ({
        name: (c.querySelector('.qc-name') || c).textContent.trim(),
        w: Math.round(c.getBoundingClientRect().width)
      }))
      const pickTitles = [...document.querySelectorAll('.pick-title')].map((t) => ({
        text: t.textContent.trim(),
        cw: t.clientWidth,
        sw: t.scrollWidth,
        clipped: t.scrollWidth > t.clientWidth + 1
      }))
      return {
        docEl: box(document.documentElement),
        body: box(document.body),
        content: box(q('.content')),
        rail: box(q('.rail-wrap')),
        quick: box(q('.quick-scroll')),
        quickCard: box(q('.quick')),
        picks: box(q('.picks')),
        picksCol: box(q('.picks-col')),
        feedHead: box(q('.feed-head')),
        hero: box(q('.hero')),
        chips,
        pickTitles,
        over
      }
    })

    console.log(`\n================ viewport ${w} ================`)
    const p = (n, b) => console.log(`  ${n.padEnd(12)} clientW=${b?.cw} scrollW=${b?.sw} offsetW=${b?.ow}${b && b.sw > b.cw + 1 ? '  ⚠横向溢出 ' + (b.sw - b.cw) + 'px' : ''}`)
    p('html', r.docEl); p('body', r.body); p('.content', r.content); p('.rail-wrap', r.rail)
    p('.quick', r.quickCard); p('.quick-scroll', r.quick); p('.picks', r.picks); p('.picks-col', r.picksCol)
    p('.feed-head', r.feedHead); p('.hero', r.hero)

    console.log(`\n  [热门游戏 chips] 共 ${r.chips.length} 个，合计宽 ${r.chips.reduce((a, b) => a + b.w, 0)}px，容器可视 ${r.quick?.cw}px`)
    console.log('   ' + r.chips.map((c) => `${c.name}(${c.w})`).join(' '))

    const clipped = r.pickTitles.filter((t) => t.clipped)
    console.log(`\n  [精选/热门标题] 共 ${r.pickTitles.length} 条，被省略号截断 ${clipped.length} 条`)
    clipped.forEach((t) => console.log(`   ✂ 溢出 ${t.sw - t.cw}px | ${t.text.slice(0, 34)}`))

    console.log(`\n  [横向溢出元素] 共 ${r.over.length} 个`)
    r.over.sort((a, b) => b.diff - a.diff).slice(0, 12).forEach((o) =>
      console.log(`   +${String(o.diff).padStart(4)}px  ${o.tag}.${o.cls}  (overflow-x:${o.ox} y:${o.oy})`))

    await page.close()
  }
  await browser.close()
})()

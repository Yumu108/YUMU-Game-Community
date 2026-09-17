/** 探针：找出 H5 页面真正的滚动容器，并观察 onReachBottom 是否触发。 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.MP_BASE || 'http://localhost:5199/m'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`${BASE}/#/pages/games/games`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await sleep(3000)

  console.log('初始 .gitem =', await page.$$eval('.gitem', (e) => e.length))

  const info = await page.evaluate(() => {
    const cands = [
      ['documentElement', document.documentElement],
      ['body', document.body],
      ['uni-page-wrapper', document.querySelector('uni-page-wrapper')],
      ['uni-page-body', document.querySelector('uni-page-body')],
      ['uni-app', document.querySelector('uni-app')]
    ]
    return cands.map(([n, el]) => {
      if (!el) return { n, missing: true }
      const cs = getComputedStyle(el)
      return {
        n,
        clientH: el.clientHeight,
        scrollH: el.scrollHeight,
        overflowY: cs.overflowY,
        canScroll: el.scrollHeight > el.clientHeight + 4
      }
    })
  })
  console.log('\n== 容器测量 ==')
  console.table(info)

  // 依次尝试各种滚动方式，看哪个能触发加载
  const attempts = [
    ['window.scrollTo(documentElement)', () => window.scrollTo(0, document.documentElement.scrollHeight)],
    ['documentElement.scrollTop', () => { document.documentElement.scrollTop = document.documentElement.scrollHeight }],
    ['body.scrollTop', () => { document.body.scrollTop = document.body.scrollHeight }],
    ['uni-page-wrapper.scrollTop', () => { const e = document.querySelector('uni-page-wrapper'); if (e) e.scrollTop = e.scrollHeight }],
    ['dispatch scroll on window', () => window.dispatchEvent(new Event('scroll'))]
  ]

  for (const [name, fn] of attempts) {
    await page.evaluate(fn)
    await sleep(1500)
    const n = await page.$$eval('.gitem', (e) => e.length)
    const y = await page.evaluate(() => ({ winY: window.scrollY, deTop: document.documentElement.scrollTop }))
    console.log(`  ${name.padEnd(30)} → gitem=${n}  scrollY=${y.winY} deTop=${y.deTop}`)
  }

  // 看看 uni-app 的 reachBottom 判定依据
  const diag = await page.evaluate(() => {
    const el = document.documentElement
    return {
      innerHeight: window.innerHeight,
      deClient: el.clientHeight,
      deScroll: el.scrollHeight,
      bodyScroll: document.body.scrollHeight,
      atBottom: window.scrollY + window.innerHeight >= el.scrollHeight - 5,
      htmlOverflow: getComputedStyle(document.documentElement).overflowY,
      bodyOverflow: getComputedStyle(document.body).overflowY
    }
  })
  console.log('\n== 底部判定 ==', JSON.stringify(diag, null, 1))

  await browser.close()
})().catch((e) => {
  console.error('探针异常：', e.message)
  process.exit(1)
})

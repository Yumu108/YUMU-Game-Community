const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
;(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true })
  const c = await b.newContext({ viewport: { width: 390, height: 844 } })
  await c.addInitScript(() => {})
  const p = await c.newPage()
  await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(2500)
  const r = await p.evaluate(() => {
    const inner = document.querySelector('.topbar .inner')
    if (!inner) return { err: 'no topbar' }
    const kids = [...inner.children].map((el) => ({
      cls: String(el.className).slice(0, 30),
      w: Math.round(el.getBoundingClientRect().width),
      right: Math.round(el.getBoundingClientRect().right)
    }))
    const cs = getComputedStyle(inner)
    const actions = document.querySelector('.actions')
    const akids = actions ? [...actions.children].map((el) => ({
      cls: String(el.className).slice(0, 26), w: Math.round(el.getBoundingClientRect().width),
      disp: getComputedStyle(el).display
    })) : []
    return {
      vw: innerWidth, innerW: Math.round(inner.getBoundingClientRect().width),
      padding: cs.paddingLeft + '/' + cs.paddingRight, gap: cs.columnGap,
      scrollW: document.documentElement.scrollWidth,
      kids, actionsW: actions ? Math.round(actions.getBoundingClientRect().width) : null, akids
    }
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close()
})().catch((e) => { console.error(e.message); process.exit(1) })

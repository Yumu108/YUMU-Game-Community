const { chromium, devices } = require('playwright-core')
const BASE = process.env.MP_BASE || 'http://8.133.255.202/m'
;(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const ctx = await b.newContext({ ...devices['iPhone 13'], locale: 'zh-CN' })
  const p = await ctx.newPage()
  await p.goto(BASE + '/#/pages/post/detail?id=3001', { waitUntil: 'load', timeout: 40000 })
  await p.waitForTimeout(4500)
  const list = await p.evaluate(() => Array.from(document.querySelectorAll('uni-image')).map((el, i) => {
    const inner = el.querySelector('img')
    const r = el.getBoundingClientRect()
    return {
      i,
      cls: String(el.className || '').split(' ').filter(Boolean).slice(0, 3).join('.'),
      src: inner ? (inner.getAttribute('src') || '(空)') : '(无内层img)',
      bg: getComputedStyle(el).backgroundImage === 'none' ? '(无)' : getComputedStyle(el).backgroundImage.slice(0, 60),
      w: Math.round(r.width), h: Math.round(r.height),
      txt: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 20)
    }
  }))
  console.table(list)
  await b.close()
})()

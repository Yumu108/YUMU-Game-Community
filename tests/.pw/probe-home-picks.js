// 细探针：谁把 .content 撑出横向滚动条 + .picks 两列为何不等宽
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP = process.env.WEB_BASE || 'http://localhost:5173'

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => console.log('PAGEERR', e.message))
  await page.goto(APP + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForSelector('.anno-modal', { timeout: 12000 }).catch(() => {})
  await page.evaluate(() => document.querySelector('.anno-modal')?.remove())
  await page.waitForSelector('.quick-scroll', { timeout: 12000 }).catch(() => {})
  await page.waitForTimeout(800)

  const r = await page.evaluate(() => {
    const el = (s) => document.querySelector(s)
    const c = el('.content')
    const cRect = c.getBoundingClientRect()
    const picks = el('.picks')
    const pcs = getComputedStyle(picks)
    // .content 里所有「右边界超出 content 右边界」的后代
    const bleeding = []
    c.querySelectorAll('*').forEach((n) => {
      const r2 = n.getBoundingClientRect()
      const dx = Math.round(r2.right - cRect.right)
      if (dx > 1) bleeding.push({
        tag: n.tagName.toLowerCase(),
        cls: String(n.className || '').slice(0, 40),
        right: Math.round(r2.right),
        over: dx,
        w: Math.round(r2.width),
        txt: (n.textContent || '').trim().slice(0, 28)
      })
    })
    return {
      contentRect: { left: Math.round(cRect.left), right: Math.round(cRect.right), w: Math.round(cRect.width) },
      picksComputed: {
        display: pcs.display,
        cols: pcs.gridTemplateColumns,
        gap: pcs.gap,
        width: Math.round(picks.getBoundingClientRect().width)
      },
      cols: [...document.querySelectorAll('.picks-col')].map((n) => ({
        w: Math.round(n.getBoundingClientRect().width),
        sw: n.scrollWidth, cw: n.clientWidth
      })),
      items: [...document.querySelectorAll('.picks-col:first-child .pick-item')].map((n) => ({
        w: Math.round(n.getBoundingClientRect().width), sw: n.scrollWidth,
        kids: [...n.children].map((k) => `${k.className}:${Math.round(k.getBoundingClientRect().width)}`)
      })),
      bleeding: bleeding.sort((a, b) => b.over - a.over).slice(0, 14),
      // 公告弹窗移除后 body 是否恢复滚动
      bodyOverflow: getComputedStyle(document.body).overflow
    }
  })

  console.log('.content rect =', JSON.stringify(r.contentRect))
  console.log('.picks computed =', JSON.stringify(r.picksComputed))
  console.log('.picks-col =', JSON.stringify(r.cols))
  console.log('body overflow =', r.bodyOverflow)
  console.log('\n[每日精选第一列 pick-item]')
  r.items.forEach((it, i) => console.log(`  #${i} w=${it.w} sw=${it.sw} | ${it.kids.join(' | ')}`))
  console.log('\n[越出 .content 右边界 140px 的元凶]')
  r.bleeding.forEach((b) => console.log(`  +${b.over}px right=${b.right} w=${b.w} ${b.tag}.${b.cls}  «${b.txt}»`))

  await browser.close()
})()

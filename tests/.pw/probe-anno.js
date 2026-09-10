// 一次性探针：打印公告弹窗真实 computed 值 + 公告条数，用于定位断言偏差
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP = process.env.WEB_BASE || 'http://localhost:5173'

;(async () => {
  const api = await fetch('http://localhost:8080/api/announcements').then(r => r.json()).catch(e => ({ err: e.message }))
  const list = Array.isArray(api?.data) ? api.data : []
  console.log('[API] /announcements 条数 =', list.length, '| isTop =', list.filter(a => a.isTop).length)
  console.log('[API] 明细 =', list.map((a, i) => `${i}:${a.isTop ? 'TOP' : '   '}:${a.title}`).join('\n        '))

  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
  page.on('pageerror', e => console.log('PAGEERR', e.message))
  await page.goto(APP + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForSelector('.anno-modal .anno-card', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)

  const info = await page.evaluate(() => {
    const card = document.querySelector('.anno-card')
    const cs = getComputedStyle(card)
    return {
      domProgressBars: document.querySelectorAll('.anno-progress-bar').length,
      domDots: document.querySelectorAll('.anno-dots .dot').length,
      hasPinBadge: !!document.querySelector('.anno-pin-badge'),
      isTopClass: document.querySelector('.anno-modal').classList.contains('is-top'),
      shadow: cs.boxShadow,
      border: cs.borderTopColor,
      animation: cs.animation + ' | ' + cs.animationDuration + ' | ' + cs.animationName,
      cardHeight: cs.height,
      firstTitles: [...document.querySelectorAll('.anno-item-title')].map(e => e.textContent.trim())
    }
  })
  console.log('\n[DOM] progressBars =', info.domProgressBars, '| dots =', info.domDots, '| pinBadge =', info.hasPinBadge, '| isTop =', info.isTopClass)
  console.log('[DOM] animation =', info.animation)
  console.log('[DOM] card height =', info.cardHeight)
  console.log('[DOM] borderTopColor =', info.border)
  console.log('\n[BOX-SHADOW 原始串]\n', info.shadow)

  const segs = String(info.shadow).split(/,(?![^(]*\))/)
  console.log('\n[分段解析] 共', segs.length, '段')
  segs.forEach((s, i) => {
    const pxs = (s.match(/([\d.]+)px/g) || []).map(n => parseFloat(n))
    console.log(`  #${i} px=${JSON.stringify(pxs)}  ← ${s}`)
  })
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })

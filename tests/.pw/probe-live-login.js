// 线上（IP 直连）登录页版本探针：确认部署的是不是旧版产物
// 用法: node probe-live-login.js
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.WEB_BASE || 'http://8.133.255.202'

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const page = await browser.newPage({ viewport: { width: 1080, height: 620 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e.message || e)))

  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)

  const info = await page.evaluate(() => {
    const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) } }
    const submit = document.querySelector('.submit') || document.querySelector('.el-button--primary')
    const guest = document.querySelector('.guest')
    const agree = document.querySelector('.agree')
    return {
      title: document.title,
      url: location.href,
      scripts: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => /assets\//.test(s)),
      hasAgreeRow: !!agree,
      checkboxCount: document.querySelectorAll('.el-checkbox').length,
      hasAgreeInput: !!document.querySelector('.agree .el-checkbox__input'),
      agreementLink: !!document.querySelector('a[href="/agreement"], a[href="/privacy"]'),
      submitRect: r(submit),
      guestRect: r(guest),
      guestMargin: guest ? getComputedStyle(guest).margin : null,
      guestRightMinusSubmitRight: (submit && guest) ? Math.round(guest.getBoundingClientRect().right - submit.getBoundingClientRect().right) : null,
    }
  })

  console.log(JSON.stringify(info, null, 1))
  console.log('pageerrors:', errors.length)
  if (errors.length) console.log(errors.join('\n'))
  await page.screenshot({ path: 'live-login.png' })
  await browser.close()
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })

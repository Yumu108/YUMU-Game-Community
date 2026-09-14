const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const page = await browser.newPage({ viewport: { width: 1080, height: 620 } })
  page.on('pageerror', (e) => console.log('PAGEERR', e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR', m.text()) })
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(2000)

  const info = await page.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const dump = (sel) => {
      const el = q(sel)
      if (!el) return { sel, missing: true }
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        sel,
        rect: {
          left: +r.left.toFixed(1), right: +r.right.toFixed(1),
          top: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1)
        },
        margin: cs.margin,
        width: cs.width,
        padding: cs.padding,
        display: cs.display,
        boxSizing: cs.boxSizing,
        color: cs.color,
        background: cs.backgroundColor,
        borderColor: cs.borderColor,
        textAlign: cs.textAlign,
        lineHeight: cs.lineHeight,
        text: el.textContent.trim()
      }
    }
    const card = q('.login-card')
    const cr = card ? card.getBoundingClientRect() : null
    return {
      card: cr ? { left: +cr.left.toFixed(1), right: +cr.right.toFixed(1), w: +cr.width.toFixed(1) } : null,
      cardInnerW: card ? card.clientWidth : null,
      inputs: [...document.querySelectorAll('.el-input')].map((el) => {
        const r = el.getBoundingClientRect()
        return { left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1) }
      }),
      submit: dump('.submit'),
      guest: dump('.guest'),
      agreeExists: !!q('.agree'),
      checkboxCount: document.querySelectorAll('.el-checkbox').length
    }
  })
  console.log(JSON.stringify(info, null, 1))
  await page.screenshot({ path: 'login-probe.png' })

  await page.setViewportSize({ width: 360, height: 720 })
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1500)
  const diag = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const out = []
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > vw + 0.5) {
        out.push({
          tag: el.tagName,
          cls: String(el.className || '').slice(0, 55),
          text: (el.textContent || '').trim().slice(0, 16),
          right: +r.right.toFixed(1),
          w: +r.width.toFixed(1)
        })
      }
    })
    const lab = document.querySelector('.agree .el-checkbox__label')
    const scrollBefore = document.documentElement.scrollWidth
    document.querySelector('.agree')?.remove()
    const scrollNoAgree = document.documentElement.scrollWidth
    document.querySelector('.guest')?.remove()
    const scrollNoGuest = document.documentElement.scrollWidth
    return {
      vw,
      scrollW: scrollBefore,
      scrollNoAgree,
      scrollNoGuest,
      agreeLabelWhiteSpace: lab ? getComputedStyle(lab).whiteSpace : null,
      list: out.slice(0, 12)
    }
  })
  console.log('窄屏360诊断', JSON.stringify(diag, null, 1))
  await page.screenshot({ path: 'login-probe-360.png' })
  await browser.close()
})().catch((e) => { console.error(e.message); process.exit(1) })

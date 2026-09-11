const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
;(async () => {
  const login = await fetch('http://127.0.0.1:8080/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') })
  }).then((r) => r.json())
  const b = await chromium.launch({ executablePath: EXE, headless: true })
  const c = await b.newContext({ viewport: { width: 390, height: 844 } })
  await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('userInfo', u) },
    [login.data.token, JSON.stringify(login.data.user)])
  const p = await c.newPage()
  await p.goto('http://localhost:5173/post/3019', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(3000)
  const r = await p.evaluate(() => {
    const vw = innerWidth
    const path = (el) => {
      const parts = []
      let n = el
      while (n && n !== document.body && parts.length < 5) {
        parts.unshift(n.tagName.toLowerCase() + (n.className ? '.' + String(n.className).split(' ').filter(Boolean).slice(0, 2).join('.') : ''))
        n = n.parentElement
      }
      return parts.join(' > ')
    }
    const deep = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right > vw + 1) {
        // 只挑"最深的" offenders：没有子元素也溢出的
        const childOver = [...el.children].some((ch) => ch.getBoundingClientRect().right > vw + 1)
        if (!childOver) deep.push({ p: path(el), w: Math.round(r.width), right: Math.round(r.right), sw: el.scrollWidth })
      }
    }
    const inner = document.querySelector('.topbar .inner')
    return {
      vw, docScrollW: document.documentElement.scrollWidth,
      topbarPadding: inner ? getComputedStyle(inner).paddingLeft : null,
      topbarInnerW: inner ? Math.round(inner.getBoundingClientRect().width) : null,
      leafOffenders: deep.slice(0, 10), count: deep.length
    }
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close()
})().catch((e) => { console.error(e.message); process.exit(1) })

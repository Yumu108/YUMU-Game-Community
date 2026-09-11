const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP = 'http://localhost:5173'

;(async () => {
  const login = await fetch('http://127.0.0.1:8080/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') })
  }).then((r) => r.json())
  const tk = login.data.token
  const b = await chromium.launch({ executablePath: EXE, headless: true })
  const c = await b.newContext({ viewport: { width: 1200, height: 800 } })
  await c.addInitScript(
    ([t, u]) => {
      if (!localStorage.getItem('token')) {
        localStorage.setItem('token', t)
        localStorage.setItem('userInfo', u)
      }
    },
    [tk, JSON.stringify(login.data.user)]
  )
  const p = await c.newPage()
  const tag = (t) => (t ? t.slice(0, 8) : 'none')

  p.on('request', (r) => {
    const u = r.url()
    if (!u.includes('/api/')) return
    const a = r.headers()['authorization'] || ''
    console.log('  > ' + r.method() + ' ' + u.replace('http://localhost:5173', '') + ' [' + tag(a.replace('Bearer ', '')) + ']')
  })
  p.on('response', (r) => {
    const u = r.url()
    if (!u.includes('/api/')) return
    if (r.status() >= 400 || u.includes('/auth/')) {
      console.log('  < ' + r.status() + ' ' + u.replace('http://localhost:5173', ''))
    }
  })
  p.on('console', (m) => {
    if (m.type() === 'error') console.log('  CONSOLE-ERR ' + m.text().slice(0, 120))
  })

  await p.goto(APP + '/post/3019', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(3000)
  console.log('  [初始 token] ' + tag(await p.evaluate(() => localStorage.getItem('token'))))

  const exp = await p.evaluate(() => {
    const t = localStorage.getItem('token')
    const b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
    return JSON.parse(atob(b64 + pad)).exp * 1000
  })
  const waitMs = Math.max(0, exp - Date.now() - 30 * 60 * 1000) + 6000
  console.log('  （等 ' + Math.round(waitMs / 1000) + 's 进入续签窗口）')
  await p.waitForTimeout(waitMs)

  console.log('  ---- 触发续签（reload）----')
  await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(6000)
  console.log('  [最终 token] ' + tag(await p.evaluate(() => localStorage.getItem('token'))))
  await b.close()
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})

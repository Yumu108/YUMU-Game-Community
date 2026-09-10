const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const API = 'http://127.0.0.1:8080/api'
const BASE = process.env.WEB_BASE || 'http://localhost:4173'

;(async () => {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123456' })
  }).then((r) => r.json())
  const b = await chromium.launch({ executablePath: EXE, headless: true })
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await c.addInitScript(
    ([t, u]) => {
      localStorage.setItem('token', t)
      localStorage.setItem('userInfo', u)
    },
    [login.data.token, JSON.stringify(login.data.user)]
  )
  const p = await c.newPage()
  p.on('request', (r) => { if (r.url().includes('/api/')) console.log('REQ ', r.method(), r.url().replace(BASE, ''), r.headers()['authorization'] ? 'auth=yes' : 'auth=NO') })
  p.on('response', async (r) => {
    if (!r.url().includes('/api/')) return
    console.log('RES ', r.status(), r.url().replace(BASE, ''))
    if (r.status() >= 400) {
      const body = await r.text().catch(() => '')
      console.log('     body:', body.slice(0, 300))
    }
  })
  p.on('console', (m) => { if (m.type() === 'error') console.log('ERR ', m.text().slice(0, 200)) })

  await p.goto(`${BASE}/post/3019`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(2500)
  const el = await p.$('.anno-close'); if (el) await el.click().catch(() => {})
  await p.waitForTimeout(400)

  const btn = await p.$('.d-actions .el-button:nth-of-type(2)')
  console.log('按钮文本:', btn ? (await btn.innerText()).trim() : '未找到')
  if (btn) { await btn.click(); await p.waitForTimeout(3000) }
  const msg = await p.$eval('.el-message', (e) => e.innerText).catch(() => '(无 message)')
  console.log('提示:', msg)
  await b.close()
})().catch((e) => { console.error(e.message); process.exit(1) })

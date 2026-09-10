// 一次性探针：定位助手面板「填了字点发送没反应」的卡点
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'

;(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true })
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const reqs = []
  p.on('request', (r) => { if (r.url().includes('/ai/')) reqs.push('REQ ' + r.url()) })
  p.on('response', (r) => { if (r.url().includes('/ai/')) reqs.push('RES ' + r.status() + ' ct=' + r.headers()['content-type']) })
  p.on('requestfailed', (r) => { if (r.url().includes('/ai/')) reqs.push('FAIL ' + r.url() + ' ' + r.failure()?.errorText) })
  p.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)))
  p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 200)) })

  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(1500)
  const ac = await p.$('.anno-close'); if (ac) { await ac.click().catch(() => {}); await p.waitForTimeout(300) }

  await p.click('.ai-fab')
  await p.waitForSelector('.ai-panel', { timeout: 5000 })

  await p.fill('.ai-input textarea', '测试问题：YUMU 是什么？')
  const val = await p.$eval('.ai-input textarea', (el) => el.value)
  console.log('textarea value =', JSON.stringify(val))

  await p.click('.ai-send')
  for (let i = 0; i < 8; i++) {
    await p.waitForTimeout(1000)
    const state = await p.evaluate(() => ({
      sendDisabled: document.querySelector('.ai-send')?.disabled,
      msgs: [...document.querySelectorAll('.ai-bubble')].map((e) => e.textContent.slice(0, 60)),
      typing: !!document.querySelector('.ai-typing'),
      textareaVal: document.querySelector('.ai-input textarea')?.value
    }))
    console.log(`t=${i + 1}s`, JSON.stringify(state))
  }
  console.log('NET:', reqs.join(' | '))
  await b.close()
})().catch((e) => { console.error('异常', e); process.exit(1) })

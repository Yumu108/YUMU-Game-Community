/**
 * 内容富化种子 —— 视觉截图（人工目视用，非断言脚本）
 * 运行：cd tests/.pw && node shot-richseed.js
 * 输出：tests/.pw/shots/*.png
 */
const { chromium } = require('playwright-core')
const fs = require('fs')
const path = require('path')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'
const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const OUT = path.join(__dirname, 'shots')

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await chromium.launch({ executablePath: EXE, headless: true })
  const p = await b.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })

  const shots = [
    ['home', '/'],
    ['board-guide', '/board/1'],
    ['board-rant', '/board/2'],
    ['games', '/games'],
  ]
  for (const [name, url] of shots) {
    await p.goto(BASE + url, { waitUntil: 'networkidle', timeout: 40000 })
    await p.waitForTimeout(2200)
    await p.screenshot({ path: path.join(OUT, name + '.png') })
    console.log('shot:', name)
  }

  // 详情页 + 个人主页（取真实 id）
  const r = await fetch(`${API}/api/posts?size=30&sort=hot`).then((x) => x.json())
  const s = (r.data.records || []).find((x) => x.replyCount > 2) || r.data.records[0]
  if (s) {
    await p.goto(`${BASE}/post/${s.id}`, { waitUntil: 'networkidle', timeout: 40000 })
    await p.waitForTimeout(2200)
    await p.screenshot({ path: path.join(OUT, 'detail.png'), fullPage: false })
    console.log('shot: detail')
    await p.goto(`${BASE}/user/${s.userId}`, { waitUntil: 'networkidle', timeout: 40000 })
    await p.waitForTimeout(1800)
    await p.screenshot({ path: path.join(OUT, 'profile.png') })
    console.log('shot: profile')
  }
  await b.close()
})()

/**
 * 深度内容（长文 / 长讨论串 / 扩充后的游戏库）—— 视觉截图（人工目视用，非断言脚本）
 *
 * 用法：
 *   cd tests/.pw
 *   POST_ID=<长文帖 id> THREAD_ID=<讨论串帖 id> node shot-deepseed.js
 * 输出：tests/.pw/shots/deep-*.png
 *
 * 为什么不硬编码 id：库里 id 会随重新生成而漂移，硬编码会在下次重灌后截到
 * 「另一篇帖子」却还以为截对了。所以 id 由外面查库传进来。
 */
const { chromium } = require('playwright-core')
const fs = require('fs')
const path = require('path')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'
const OUT = path.join(__dirname, 'shots')

const POST_ID = process.env.POST_ID
const THREAD_ID = process.env.THREAD_ID

;(async () => {
  if (!POST_ID || !THREAD_ID) {
    console.error('缺少 POST_ID / THREAD_ID 环境变量')
    process.exit(2)
  }
  fs.mkdirSync(OUT, { recursive: true })
  const b = await chromium.launch({ executablePath: EXE, headless: true })
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 })

  // 首页 / 游戏库：看整站观感 & 新封面配色
  for (const [name, url] of [['deep-home', '/'], ['deep-games', '/games']]) {
    await p.goto(BASE + url, { waitUntil: 'networkidle', timeout: 40000 })
    await p.waitForTimeout(2200)
    await p.screenshot({ path: path.join(OUT, name + '.png') })
    console.log('shot:', name)
  }

  // 长文详情：截首屏 + 全页（全页才能看出 1500 字的体量）
  await p.goto(`${BASE}/post/${POST_ID}`, { waitUntil: 'networkidle', timeout: 40000 })
  await p.waitForTimeout(2200)
  await p.screenshot({ path: path.join(OUT, 'deep-longpost-top.png') })
  await p.screenshot({ path: path.join(OUT, 'deep-longpost-full.png'), fullPage: true })
  console.log('shot: deep-longpost')

  // 讨论串详情：滚到回复区，再全页截图（楼中楼要全页才看得到）
  await p.goto(`${BASE}/post/${THREAD_ID}`, { waitUntil: 'networkidle', timeout: 40000 })
  await p.waitForTimeout(2600)
  await p.evaluate(() => {
    const el = document.querySelector('.reply-list, .replies, .comment-list')
    if (el) el.scrollIntoView({ block: 'start' })
    else window.scrollTo(0, document.body.scrollHeight * 0.45)
  })
  await p.waitForTimeout(1200)
  await p.screenshot({ path: path.join(OUT, 'deep-thread-replies.png') })
  await p.screenshot({ path: path.join(OUT, 'deep-thread-full.png'), fullPage: true })
  console.log('shot: deep-thread')

  await b.close()
  console.log('输出目录：', OUT)
})()

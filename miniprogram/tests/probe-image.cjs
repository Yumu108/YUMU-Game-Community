/**
 * 一次性探针：H5 里 uni-app 的 <image> 到底渲染成什么？
 * 目的：确认封面图在**真实浏览器**里能不能解码成功（而不是靠 DOM 猜）。
 */
const { chromium } = require('playwright-core')
const EXE = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.MP_BASE || 'http://localhost:5199/m'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()

  const fileReqs = []
  page.on('response', async (r) => {
    const u = r.url()
    if (u.includes('/api/files/')) {
      fileReqs.push({ raw: u, status: r.status(), ct: r.headers()['content-type'] || '' })
    }
  })

  const html = []
  page.on('console', (m) => html.push(`${m.type()}: ${m.text()}`))

  await page.goto(`${BASE}/?t=${Date.now()}#/pages/news/news`, { waitUntil: 'domcontentloaded' })
  await sleep(3000)

  const dom = await page.evaluate(() => {
    const out = { uniImage: document.querySelectorAll('uni-image').length, inner: [] }
    for (const el of Array.from(document.querySelectorAll('uni-image')).slice(0, 3)) {
      const kid = el.firstElementChild
      let info = { tag: kid && kid.tagName }
      if (kid && kid.tagName === 'IMG') {
        info.src = kid.getAttribute('src')
        info.naturalWidth = kid.naturalWidth
      } else if (kid) {
        info.backgroundImage = getComputedStyle(kid).backgroundImage
      }
      out.inner.push(info)
    }
    out.imgs = Array.from(document.querySelectorAll('img')).filter((i) => i.src.includes('/api/files/')).length
    return out
  })

  console.log('DOM:', JSON.stringify(dom, null, 1))
  console.log('图片请求数:', fileReqs.length)
  console.log('样本:', JSON.stringify(fileReqs.slice(0, 5), null, 1))
  console.log('有非图片响应:', fileReqs.filter((r) => !r.ct.startsWith('image/')).length)
  console.log('console:', html.slice(0, 6).join('\n  '))

  await browser.close()
})().catch((e) => {
  console.error('探针异常:', e.message)
  process.exit(1)
})

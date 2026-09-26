/**
 * 手机端真机模拟探针（打线上 /m/）
 * 目的：回答「手机上到底能不能看、长什么样」
 * 跑法：
 *   MP_BASE=http://8.133.255.202/m NODE_PATH='E:\2kewai\YUMUGameCommunity\tests\.pw\node_modules' \
 *     node tests/.pw/probe-mobile-live.cjs
 */
const { chromium, devices } = require('playwright-core')
const fs = require('fs')
const path = require('path')

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.MP_BASE || 'http://8.133.255.202/m'
const SHOTS = process.env.SHOT_DIR || 'E:/2kewai/YUMUGameCommunity/docs/screenshots'

const pass = [], fail = []
const ok = (n, extra = '') => pass.push(`✅ ${n}${extra ? '  [' + extra + ']' : ''}`)
const no = (n, extra = '') => fail.push(`❌ ${n}${extra ? '  [' + extra + ']' : ''}`)

async function runDevice(browser, devName, tag) {
  console.log(`\n--- ${devName} ---`)
  const ctx = await browser.newContext({ ...devices[devName], locale: 'zh-CN' })
  const page = await ctx.newPage()
  const errs = [], imgFail = [], apiFail = []

  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 160)) })
  page.on('response', (r) => {
    const t = r.request().resourceType()
    if (t === 'image' && r.status() >= 400) imgFail.push(r.status() + ' ' + r.url().slice(-60))
    if (r.url().includes('/api/') && r.status() >= 400) apiFail.push(r.status() + ' ' + r.url().slice(-70))
  })

  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 40000 }).catch((e) => errs.push('GOTO ' + e.message))
  await page.waitForTimeout(4500)

  // ① viewport meta（决定真机是移动宽度还是 980px 桌面宽度）
  const vp = await page.evaluate(() => {
    const m = document.querySelector('meta[name=viewport]')
    const cs = document.querySelector('meta[charset]')
    return { has: !!m, content: m ? m.getAttribute('content') : null, inner: innerWidth, dpr: devicePixelRatio, charset: cs ? cs.getAttribute('charset') : null }
  })
  vp.has
    ? ok(`${tag} viewport meta 存在（真机按移动宽度渲染）`, `innerWidth=${vp.inner} dpr=${vp.dpr} ${vp.content}`)
    : no(`${tag} viewport meta 缺失 ⇒ 真机会按 980px 桌面宽度渲染、布局全乱`, `innerWidth=${vp.inner}`)

  // ② 首页内容
  const home = await page.evaluate(() => {
    const cards = document.querySelectorAll('.pc')
    const tabs = document.querySelectorAll('.uni-tabbar .uni-tabbar__item')
    const imgs = Array.from(document.querySelectorAll('uni-image')).map((el) => {
      const inner = el.querySelector('img')
      const bg = getComputedStyle(el).backgroundImage
      return { src: inner ? inner.getAttribute('src') : null, bg: bg && bg !== 'none' ? bg.slice(0, 70) : null, w: el.getBoundingClientRect().width }
    })
    return {
      cards: cards.length,
      firstTitle: cards[0] ? (cards[0].innerText || '').replace(/\s+/g, ' ').slice(0, 30) : null,
      tabs: Array.from(tabs).map((t) => (t.innerText || '').replace(/\s+/g, ' ')),
      imgTotal: imgs.length,
      imgWithSrc: imgs.filter((i) => i.src).length,
      imgWithBg: imgs.filter((i) => i.bg).length,
      imgZeroW: imgs.filter((i) => i.w < 2).length,
      scrollW: document.documentElement.scrollWidth,
      innerW: innerWidth
    }
  })
  home.cards > 0 ? ok(`${tag} 首页渲染出卡片`, `${home.cards} 张 · 首张「${home.firstTitle}」`) : no(`${tag} 首页无卡片`)
  home.tabs.length >= 3 ? ok(`${tag} 底部 tabBar 渲染`, home.tabs.join(' / ')) : no(`${tag} tabBar 异常`, JSON.stringify(home.tabs))
  const imgOk = home.imgWithSrc + home.imgWithBg
  imgOk > 0 ? ok(`${tag} 图片有真实来源`, `共 ${home.imgTotal} 个 uni-image，有 src ${home.imgWithSrc} / 有背景图 ${home.imgWithBg}，零宽 ${home.imgZeroW}`) : no(`${tag} 图片全无来源（真机白图）`)
  home.scrollW <= home.innerW + 1 ? ok(`${tag} 无横向溢出`, `scrollWidth=${home.scrollW} ≤ ${home.innerW}`) : no(`${tag} 横向溢出`, `scrollWidth=${home.scrollW} > ${home.innerW}`)
  await page.screenshot({ path: path.join(SHOTS, `mobile-${tag}-1-首页.png`), fullPage: false })

  // ③ 进详情页
  const clicked = await page.evaluate(() => {
    const c = document.querySelector('.pc')
    if (!c) return false
    c.scrollIntoView(); c.click(); return true
  })
  if (clicked) {
    await page.waitForTimeout(4000)
    const d = await page.evaluate(() => ({
      hash: location.hash,
      title: (document.querySelector('.d-title, .title') || {}).innerText || null,
      imgs: document.querySelectorAll('uni-image').length,
      // 内容图（封面/缩略图）必须有来源；作者头像等「无头像时用 CSS 占位」属设计行为，不参与判定
      contentImgs: document.querySelectorAll('.pc__thumb').length,
      contentImgsWithSrc: Array.from(document.querySelectorAll('.pc__thumb')).filter((el) => {
        const i = el.querySelector('img'); return (i && i.getAttribute('src')) || (getComputedStyle(el).backgroundImage !== 'none')
      }).length,
      zeroW: Array.from(document.querySelectorAll('uni-image')).filter((el) => el.getBoundingClientRect().width < 2).length,
      scrollW: document.documentElement.scrollWidth, innerW: innerWidth
    }))
    d.hash.includes('/post/detail') ? ok(`${tag} 点卡片进得了详情页`, d.hash) : no(`${tag} 未跳详情页`, d.hash)
    d.title ? ok(`${tag} 详情页有标题`, String(d.title).slice(0, 30)) : no(`${tag} 详情页标题取不到`)
    d.contentImgs > 0 && d.contentImgsWithSrc === d.contentImgs
      ? ok(`${tag} 内容图都有来源`, `${d.contentImgsWithSrc}/${d.contentImgs}（另 ${d.imgs - d.contentImgs} 个为头像/图标类占位）`)
      : no(`${tag} 内容图有图无来源`, `${d.contentImgsWithSrc}/${d.contentImgs}`)
    d.zeroW === 0 ? ok(`${tag} 无零宽图片（没有渲染成 0 尺寸的坏元素）`) : no(`${tag} 有 ${d.zeroW} 个零宽图片`)
    d.scrollW <= d.innerW + 1 ? ok(`${tag} 详情页无横向溢出`) : no(`${tag} 详情页横向溢出`, `${d.scrollW} > ${d.innerW}`)
    await page.screenshot({ path: path.join(SHOTS, `mobile-${tag}-2-详情.png`) })
    // 回首页
    await page.goto(BASE + '/', { waitUntil: 'load' }).catch(() => {})
    await page.waitForTimeout(3000)
  }

  // ④ 切到「资讯」tab
  const goNews = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.uni-tabbar .uni-tabbar__item'))
    const t = items.find((el) => (el.innerText || '').includes('资讯'))
    if (!t) return false
    t.click(); return true
  })
  if (goNews) {
    await page.waitForTimeout(4000)
    const news = await page.evaluate(() => ({
      hash: location.hash,
      cards: document.querySelectorAll('.pc').length,
      first: (document.querySelector('.pc') || {}).innerText || ''
    }))
    news.cards > 0 ? ok(`${tag} 切「资讯」有内容`, `${news.cards} 张 · ${String(news.first).replace(/\s+/g, ' ').slice(0, 26)}`) : no(`${tag} 「资讯」空白`, news.hash)
    await page.screenshot({ path: path.join(SHOTS, `mobile-${tag}-3-资讯.png`) })
  } else {
    no(`${tag} 点不到「资讯」tab`)
  }

  // ⑤ 网络与控制台
  imgFail.length === 0 ? ok(`${tag} 无图片 4xx/5xx`) : no(`${tag} 图片加载失败 ${imgFail.length} 个`, imgFail.slice(0, 3).join(' | '))
  apiFail.length === 0 ? ok(`${tag} 无接口 4xx/5xx`) : no(`${tag} 接口失败 ${apiFail.length} 个`, apiFail.slice(0, 3).join(' | '))
  errs.length === 0 ? ok(`${tag} 控制台无报错`) : no(`${tag} 控制台有 ${errs.length} 条报错`, errs.slice(0, 2).join(' | '))

  await ctx.close()
}

;(async () => {
  fs.mkdirSync(SHOTS, { recursive: true })
  console.log(`探测目标：${BASE}`)
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  try {
    await runDevice(browser, 'iPhone 13', 'iOS')
    await runDevice(browser, 'Pixel 5', '安卓')
  } finally {
    await browser.close()
  }
  console.log('\n' + pass.join('\n'))
  if (fail.length) console.log('\n' + fail.join('\n'))
  console.log(`\n=== 结果：${pass.length}/${pass.length + fail.length} 通过 ===`)
  console.log('截图目录：' + SHOTS)
  process.exit(fail.length === 0 ? 0 : 1)
})().catch((e) => { console.error('脚本崩溃：', e.message); process.exit(2) })

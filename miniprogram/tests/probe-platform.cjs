/**
 * 探针：为什么会「平台分类全是 0」——
 *
 * 不猜，直接把三件事同时打出来：
 *   ① 页面 DOM 上平台档位按钮的真实文案（含计数）；
 *   ② 端内索引缓存 `yumu_game_platform` 的实际内容（map / platforms / genres）；
 *   ③ 端内索引缓存 `yumu_guide_index` 里 items 的 platform 分布。
 *
 * 用法：
 *   MP_BASE=http://8.133.255.202/m NODE_PATH=<repo>/tests/.pw/node_modules \
 *     node miniprogram/tests/probe-platform.cjs
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.MP_BASE || 'http://localhost:5173/m'

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 900 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERR', e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE-ERR', m.text().slice(0, 200))
  })

  const apiCalls = []
  page.on('request', (r) => {
    const u = r.url()
    if (u.includes('/api/games') || u.includes('/api/posts')) apiCalls.push(u.replace(/^https?:\/\/[^/]+/, ''))
  })

  // 干净起点：先清缓存再走一遍，避免读到上一轮的脏缓存
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1500)
  await page.evaluate(() => { try { localStorage.clear() } catch (e) {} })

  console.log('=== A. 游戏库页（清缓存后首跑）===')
  await page.goto(BASE + '/#/pages/games/games', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(6000)

  const dumpTabs = () =>
    page.evaluate(() => {
      const texts = (sel) =>
        Array.from(document.querySelectorAll(sel)).map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
      return {
        platTabs: texts('.pf__btn'),
        genres: texts('.chip'),
        items: document.querySelectorAll('.gitem').length
      }
    })
  console.log('DOM:', JSON.stringify(await dumpTabs(), null, 1))

  const cache = await page.evaluate(() => {
    const raw = localStorage.getItem('yumu_game_platform')
    let parsed = raw
    try { parsed = JSON.parse(raw) } catch (e) {}
    // uni-app H5 的 setStorageSync 会包一层 {type,data}
    if (parsed && typeof parsed === 'object' && parsed.data !== undefined) parsed = parsed.data
    const out = { rawLength: raw ? raw.length : 0 }
    if (parsed && typeof parsed === 'object') {
      out.at = parsed.at
      out.mapKeys = Object.keys(parsed.map || {}).length
      out.mapSample = Object.entries(parsed.map || {}).slice(0, 5)
      out.platforms = parsed.platforms
      out.genres = (parsed.genres || []).slice(0, 6)
    } else {
      out.rawHead = String(raw).slice(0, 200)
    }
    return out
  })
  console.log('GAME_PLATFORM 缓存:', JSON.stringify(cache, null, 1))

  console.log('\n=== B. 攻略库首页（同一份缓存）===')
  await page.goto(BASE + '/#/pages/index/index', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(4000)
  console.log('DOM:', JSON.stringify(await dumpTabs(), null, 1))

  const idx = await page.evaluate(() => {
    const raw = localStorage.getItem('yumu_guide_index')
    let parsed = raw
    try { parsed = JSON.parse(raw) } catch (e) {}
    if (parsed && typeof parsed === 'object' && parsed.data !== undefined) parsed = parsed.data
    const items = (parsed && parsed.items) || []
    const dist = {}
    items.forEach((it) => {
      const k = it.platform || '(空)'
      dist[k] = (dist[k] || 0) + 1
    })
    return {
      rawLength: raw ? raw.length : 0,
      n: items.length,
      dist,
      sample: items.slice(0, 3).map((it) => ({ id: it.id, gameId: it.gameId, gameName: it.gameName, platform: it.platform })),
      gameIdTypes: Array.from(new Set(items.map((it) => typeof it.gameId))).slice(0, 4)
    }
  })
  console.log('GUIDE_INDEX 缓存:', JSON.stringify(idx, null, 1))

  console.log('\n=== C. 本轮真实请求 ===')
  console.log(apiCalls.slice(0, 12).join('\n'))

  await browser.close()
})().catch((e) => {
  console.error('探针失败:', e.message)
  process.exit(1)
})

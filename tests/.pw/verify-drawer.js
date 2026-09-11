/**
 * 9-10 移动端导航抽屉 UI 验证（playwright-core + 系统 Chrome）
 *
 * 用法（需 5173 dev server + 8080 后端都在跑）：
 *   cd tests/.pw && node verify-drawer.js
 *
 * 覆盖：
 *   A. 桌面端 1440px —— 汉堡不存在、左侧栏正常、抽屉不渲染、无横向溢出
 *   B. 移动端 390px —— 汉堡出现且不溢出、左栏收起、点汉堡开抽屉
 *   C. 抽屉本身 —— 面板/遮罩/宽度/滚动锁/导航项/搜索入口/透明背景
 *   D. 关闭路径 —— 遮罩、关闭键、ESC、点导航项（含「同路由」这一坑）、拉宽到桌面
 *   E. 全程无控制台错误
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP = 'http://localhost:5173'
const API = 'http://127.0.0.1:8080/api'

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${extra ? ' —— ' + extra : ''}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  ❌ ${name}${extra ? ' —— ' + extra : ''}`)
  }
}

async function apiLogin() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') })
  })
  const json = await res.json()
  return { token: json.data.token, user: json.data.user }
}

;(async () => {
  const { token, user } = await apiLogin()

  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  // 不用 isMobile：会触发 shrink-to-fit，innerWidth 变成 625 而非 390，媒体查询断言失真
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(
    ([t, u]) => {
      if (!localStorage.getItem('token')) {
        localStorage.setItem('token', t)
        localStorage.setItem('userInfo', u)
      }
    },
    [token, JSON.stringify(user)]
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE ' + m.text())
  })

  // ---------- 通用小工具 ----------
  const snap = () =>
    page.evaluate(() => {
      const cs = (sel) => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el) : null
      }
      const rect = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right) }
      }
      const offenders = []
      const vw = window.innerWidth
      // 元素若位于「横向滚动/裁切容器」内部，就不算撑破页面：
      // 这类区域（首页快捷入口条、侧栏卡片行）本来就靠 overflow-x:auto 横向滑，
      // 元素右边缘超出视口是设计使然，documentElement.scrollWidth 也仍然是视口宽。
      const inClippedScroller = (el) => {
        let p = el.parentElement
        while (p && p !== document.body) {
          const ox = getComputedStyle(p).overflowX
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true
          p = p.parentElement
        }
        return false
      }
      let clippedCount = 0
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.right <= vw + 1) continue
        if (inClippedScroller(el)) { clippedCount++; continue }
        offenders.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40), right: Math.round(r.right) })
      }
      return {
        vw,
        scrollW: document.documentElement.scrollWidth,
        offenderCount: offenders.length,
        offenders: offenders.slice(0, 6),
        clippedCount,
        toggleDisplay: cs('.nav-toggle')?.display,
        toggleRect: rect('.nav-toggle'),
        gridSideDisplay: cs('.body > .side')?.display,
        topSearchDisplay: cs('.topbar .search')?.display,
        panelExists: !!document.querySelector('.nav-panel'),
        maskExists: !!document.querySelector('.nav-mask'),
        panelRect: rect('.nav-panel'),
        bodyOverflow: document.body.style.overflow,
        navItemCount: document.querySelectorAll('.nav-panel .nav-item').length,
        drawerSearchDisplay: cs('.nav-panel-search')?.display,
        drawerSideBg: cs('.nav-panel .side')?.backgroundColor,
        drawerSideBorder: cs('.nav-panel .side')?.borderTopWidth,
        path: location.pathname
      }
    })

  async function openDrawer() {
    await page.click('.nav-toggle')
    await page.waitForTimeout(480)
  }
  async function closeVia(sel) {
    if (sel === 'esc') {
      await page.keyboard.press('Escape')
    } else if (sel === 'mask') {
      // ⚠️ 不能直接 page.click('.nav-mask')：遮罩铺满全屏（inset:0），
      //    Playwright 默认点几何中心 → 落点在抽屉面板上被 intercept。
      //    改点面板右侧的空白区域。
      const vp = page.viewportSize()
      await page.mouse.click(vp.width - 25, Math.round(vp.height / 2))
    } else {
      await page.click(sel)
    }
    await page.waitForTimeout(480)
  }
  // 首页会弹公告弹窗（遮罩铺满全屏，会拦截所有点击）——每次进入页面前先关掉
  async function dismissAnno() {
    for (let i = 0; i < 3; i++) {
      if (!(await page.$('.anno-modal'))) return
      const c = await page.$('.anno-modal .anno-close')
      if (c) await c.click({ timeout: 3000 }).catch(() => {})
      else await page.keyboard.press('Escape')
      await page.waitForTimeout(350)
    }
  }

  console.log('\n=== A. 桌面端 1440px ===\n')
  await page.goto(APP + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await dismissAnno()
  let s = await snap()
  ok('A1) 汉堡按钮不显示（display:none）', s.toggleDisplay === 'none', `display=${s.toggleDisplay}`)
  ok('A2) 桌面左栏仍正常显示', s.gridSideDisplay !== 'none', `display=${s.gridSideDisplay}`)
  ok('A3) 抽屉未被渲染', !s.panelExists && !s.maskExists)
  ok('A4) 桌面顶栏搜索框正常', s.topSearchDisplay !== 'none', `display=${s.topSearchDisplay}`)
  ok('A5) 桌面无横向溢出', s.scrollW <= s.vw + 1, `scrollW=${s.scrollW} vw=${s.vw}`)

  console.log('\n=== B. 移动端 390×844 ===\n')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(700)
  s = await snap()
  ok('B1) 汉堡按钮出现', s.toggleDisplay !== 'none', `display=${s.toggleDisplay}`)
  ok('B2) 汉堡按钮在视口内', !!s.toggleRect && s.toggleRect.right <= s.vw + 1, JSON.stringify(s.toggleRect))
  ok('B3) 移动端左栏收起', s.gridSideDisplay === 'none', `display=${s.gridSideDisplay}`)
  ok('B4) 移动端顶栏搜索框隐藏（转由抽屉承接）', s.topSearchDisplay === 'none', `display=${s.topSearchDisplay}`)
  ok('B5) 无横向溢出（scrollWidth <= 视口）', s.scrollW <= s.vw + 1, `scrollW=${s.scrollW} vw=${s.vw}`)
  ok('B6) 无元素超出视口右边界（排除横向滚动容器内部）', s.offenderCount === 0,
    s.offenderCount ? JSON.stringify(s.offenders) : `（${s.clippedCount} 个元素位于横向滚动容器内，属预期）`)
  await page.screenshot({ path: 'drawer-closed-390.png' })

  console.log('\n=== C. 抽屉打开后 ===\n')
  await openDrawer()
  s = await snap()
  ok('C1) 抽屉面板已渲染', s.panelExists)
  ok('C2) 遮罩已渲染', s.maskExists)
  ok('C3) 面板在视口内（left>=0 且 right<=vw）',
    !!s.panelRect && s.panelRect.left >= -1 && s.panelRect.right <= s.vw + 1,
    JSON.stringify(s.panelRect))
  ok('C4) 打开时锁定 body 滚动', s.bodyOverflow === 'hidden', `overflow="${s.bodyOverflow}"`)
  ok('C5) 抽屉内导航项齐全（>=6 项）', s.navItemCount >= 6, `count=${s.navItemCount}`)
  ok('C6) 抽屉内搜索入口显示', s.drawerSearchDisplay === 'block', `display=${s.drawerSearchDisplay}`)
  ok('C7) 抽屉内 SideNav 已去卡片外观（背景透明 / 无边框）',
    s.drawerSideBg === 'rgba(0, 0, 0, 0)' && s.drawerSideBorder === '0px',
    `bg=${s.drawerSideBg} borderTop=${s.drawerSideBorder}`)
  await page.screenshot({ path: 'drawer-open-390.png' })

  console.log('\n=== D. 各条关闭路径 ===\n')
  // D1 点遮罩
  await closeVia('mask')
  s = await snap()
  ok('D1) 点遮罩可关闭，且解除滚动锁', !s.panelExists && s.bodyOverflow === '', `overflow="${s.bodyOverflow}"`)

  // D2 关闭按钮
  await openDrawer()
  await closeVia('.np-close')
  s = await snap()
  ok('D2) 关闭按钮可关闭', !s.panelExists)

  // D3 ESC
  await openDrawer()
  await closeVia('esc')
  s = await snap()
  ok('D3) ESC 可关闭', !s.panelExists)

  // D4 点导航项 —— 同路由场景（当前就在首页，点「综合首页」fullPath 不变）
  await openDrawer()
  await page.click('.nav-panel a.nav-item[href="/"]')
  await page.waitForTimeout(500)
  s = await snap()
  ok('D4) 同路由导航也关抽屉（当前在首页点「综合首页」）', !s.panelExists && s.bodyOverflow === '',
    `panel=${s.panelExists} overflow="${s.bodyOverflow}"`)

  // D5 点板块项 —— 跨路由，应跳转且自动关闭
  await openDrawer()
  const boardHref = await page.evaluate(() => {
    const a = document.querySelector('.nav-panel a.nav-item[href^="/board/"]')
    return a ? a.getAttribute('href') : null
  })
  if (boardHref) {
    await page.click(`.nav-panel a.nav-item[href="${boardHref}"]`)
    await page.waitForTimeout(900)
    s = await snap()
    ok('D5) 点板块项：已跳转且抽屉自动关闭',
      s.path === boardHref && !s.panelExists, `path=${s.path} expect=${boardHref} panel=${s.panelExists}`)
  } else {
    ok('D5) 点板块项：已跳转且抽屉自动关闭', false, '未找到板块导航项')
  }

  // D6 打开状态下拉宽到桌面 → 必须强制收起并解锁滚动（否则整页再也滚不动）
  await page.goto(APP + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await dismissAnno()
  await openDrawer()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(700)
  s = await snap()
  ok('D6) 拉宽到桌面后抽屉强制收起 + 滚动锁解除',
    !s.panelExists && s.bodyOverflow === '' && s.gridSideDisplay !== 'none',
    `panel=${s.panelExists} overflow="${s.bodyOverflow}" side=${s.gridSideDisplay}`)

  console.log('\n=== F. hide-rail 页面（/editor，AppLayout no-rail）390px ===\n')
  await page.setViewportSize({ width: 390, height: 844 }) // D6 拉到过 1440，这里调回窄屏
  await page.goto(APP + '/editor', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  await dismissAnno()
  s = await snap()
  const noRailSide = await page.evaluate(() => {
    const el = document.querySelector('.body.no-rail > .side')
    return el ? getComputedStyle(el).display : 'missing'
  })
  ok('F1) 汉堡在 no-rail 页面同样出现', s.toggleDisplay !== 'none', `display=${s.toggleDisplay}`)
  ok('F2) no-rail 布局下左栏收起', noRailSide === 'none' || noRailSide === 'missing', `display=${noRailSide}`)
  ok('F3) 无横向溢出', s.scrollW <= s.vw + 1, `scrollW=${s.scrollW} vw=${s.vw}`)
  await openDrawer()
  s = await snap()
  ok('F4) 抽屉可打开且导航项齐全', s.panelExists && s.navItemCount >= 6,
    `panel=${s.panelExists} count=${s.navItemCount}`)
  await closeVia('esc')

  console.log('\n=== G. 中屏 700px：搜索框不重复出现 ===\n')
  await page.setViewportSize({ width: 700, height: 900 })
  await page.goto(APP + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await dismissAnno()
  s = await snap()
  ok('G1) 700px 顶栏搜索可见（未命中 480 隐藏断点）', s.topSearchDisplay !== 'none', `display=${s.topSearchDisplay}`)
  ok('G2) 700px 无横向溢出', s.scrollW <= s.vw + 1, `scrollW=${s.scrollW} vw=${s.vw}`)
  await openDrawer()
  s = await snap()
  ok('G3) 700px 抽屉可打开（汉堡在 ≤760 区间有效）', s.panelExists)
  ok('G4) 700px 抽屉内搜索隐藏（与顶栏搜索不重复）', s.drawerSearchDisplay === 'none', `display=${s.drawerSearchDisplay}`)
  await closeVia('esc')

  const realErrors = errors.filter((e) => !/favicon|ResizeObserver/.test(e))
  ok('E) 无页面/控制台错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

  await browser.close()
  console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
  if (failures.length) console.log('未通过：\n - ' + failures.join('\n - '))
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('脚本异常：', e)
  process.exit(1)
})

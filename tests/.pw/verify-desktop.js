/**
 * 桌面端回归检查：确认移动端断点改造没有影响宽屏布局
 * （顶栏内边距/间距仍是桌面值、详情页标题仍是 22px、无横向溢出）
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

;(async () => {
  const login = await fetch('http://127.0.0.1:8080/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') })
  }).then((r) => r.json())
  const b = await chromium.launch({ executablePath: EXE, headless: true })
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await c.addInitScript(
    ([t, u]) => {
      if (!localStorage.getItem('token')) {
        localStorage.setItem('token', t)
        localStorage.setItem('userInfo', u)
      }
    },
    [login.data.token, JSON.stringify(login.data.user)]
  )
  const p = await c.newPage()
  const errs = []
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))

  await p.goto('http://localhost:5173/post/3019', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(3000)

  const r = await p.evaluate(() => {
    const cs = (sel, prop) => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el)[prop] : null
    }
    const inner = document.querySelector('.topbar .inner')
    return {
      vw: window.innerWidth,
      scrollW: document.documentElement.scrollWidth,
      topbarPadding: inner ? getComputedStyle(inner).paddingLeft : null,
      topbarGap: inner ? getComputedStyle(inner).columnGap : null,
      logoTextDisplay: cs('.logo-text', 'display'),
      signBtnDisplay: cs('.sign-btn', 'display'),
      titleSize: cs('.d-title', 'fontSize'),
      detailPadding: cs('.detail', 'paddingLeft'),
      statsMarginLeft: cs('.d-stats', 'marginLeft'),
      statsJustify: cs('.d-stats', 'justifyContent'),
      sideVisible: cs('.side', 'display'),
      imgMaxHeight: (() => {
        const img = document.querySelector('.d-body img')
        return img ? getComputedStyle(img).maxHeight : 'no-img'
      })()
    }
  })
  console.log(JSON.stringify(r, null, 1))

  const checks = [
    ['桌面无横向溢出', r.scrollW <= r.vw + 1, `scrollW=${r.scrollW} vw=${r.vw}`],
    ['顶栏保持桌面内边距 20px', r.topbarPadding === '20px', String(r.topbarPadding)],
    ['顶栏保持桌面间距 18px', r.topbarGap === '18px', String(r.topbarGap)],
    ['Logo 文案在桌面可见', r.logoTextDisplay !== 'none', String(r.logoTextDisplay)],
    ['签到按钮在桌面可见', r.signBtnDisplay !== 'none', String(r.signBtnDisplay)],
    ['详情页标题 22px', r.titleSize === '22px', String(r.titleSize)],
    ['统计信息未被移动端规则改写（justify 保持默认）',
      r.statsJustify !== 'flex-start', String(r.statsJustify)],
    ['左侧导航在桌面可见', r.sideVisible !== 'none', String(r.sideVisible)],
    ['无控制台错误', errs.filter((e) => !/favicon/.test(e)).length === 0, errs.slice(0, 2).join(' | ')]
  ]
  let pass = 0
  for (const [n, ok, extra] of checks) {
    console.log(`  ${ok ? '✅' : '❌'} ${n}${extra ? ' —— ' + extra : ''}`)
    if (ok) pass++
  }
  console.log(`\n=== 桌面端：${pass}/${checks.length} 通过 ===`)
  await p.screenshot({ path: 'desktop-detail.png' })
  await b.close()
  process.exit(pass === checks.length ? 0 : 1)
})().catch((e) => { console.error(e.message); process.exit(1) })

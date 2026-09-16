/**
 * 线上站点（8.133.255.202）上线后目视验收 —— 截两张图：
 *   ① 首页（确认 SPA 正常渲染、不是空白/404 页）
 *   ② 登录页的注册 Tab（确认「邮箱 + 验证码」字段真的在线上）
 *
 * 用法：node probe-online.js
 *   可选环境变量：SITE（默认 http://8.133.255.202）
 * 产物：online-home.png / online-register.png（同目录）
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SITE = (process.env.SITE || 'http://8.133.255.202').replace(/\/$/, '')

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  page.on('pageerror', (e) => errs.push(String(e)))

  // ① 首页
  await page.goto(`${SITE}/`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const title = await page.title()
  const hasNav = await page.locator('header, .app-header, nav').count()
  const bodyLen = (await page.locator('body').innerText().catch(() => '')).length
  await page.screenshot({ path: 'online-home.png' })
  console.log(`首页：title="${title}" / 导航元素 ${hasNav} 个 / 可见文本 ${bodyLen} 字`)

  // ② 登录页 → 切注册 Tab
  await page.goto(`${SITE}/login`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(1500)
  // ElementPlus 的 Tab 不是 role=tab，按类名/文本兜底（踩过：只写 getByRole 会点不中，
  // 结果截图里还停在「登录」Tab，误判成「线上没有验证码字段」）
  const candidates = [
    page.locator('.el-tabs__item', { hasText: '注册' }),
    page.getByText('注册', { exact: true }),
    page.locator('text="注册"')
  ]
  let clicked = false
  for (const c of candidates) {
    if (await c.count()) {
      await c.first().click().catch(() => {})
      clicked = true
      break
    }
  }
  console.log(`注册 Tab 点击：${clicked ? '已点击' : '❌ 没找到可点的「注册」'}`)
  await page.waitForTimeout(1500)
  const txt = await page.locator('body').innerText().catch(() => '')
  const flags = {
    '有「邮箱」字样': /邮箱/.test(txt),
    '有「验证码」字样': /验证码/.test(txt),
    '有「发送」按钮': /发送/.test(txt),
    '有「账号」字样': /账号/.test(txt)
  }
  await page.screenshot({ path: 'online-register.png' })
  console.log('注册 Tab 检查：' + Object.entries(flags).map(([k, v]) => `${k}=${v ? '✅' : '❌'}`).join('  '))
  if (errs.length) console.log(`控制台错误 ${errs.length} 条：\n  ` + errs.slice(0, 5).join('\n  '))
  else console.log('控制台无错误 ✅')

  await browser.close()
})()

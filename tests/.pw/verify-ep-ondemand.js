/**
 * Element Plus 按需引入 —— 回归冒烟（playwright-core + 系统 Chrome）
 *
 * 背景：9-10 把 `app.use(ElementPlus)` + 全量 index.css 改为
 *   unplugin-vue-components + unplugin-auto-import 按需引入。
 *   按需引入最容易出两类"构建通过但运行时炸"的问题：
 *     ① 模板里的 <el-xxx> / v-loading 没被解析 → 控制台 warning（构建与接口测试都发现不了）
 *     ② 代码里的 ElMessage / ElMessageBox 没被注入 → ReferenceError（只在触发时才炸）
 *   本脚本全站巡检 + 真实触发这两类 API。
 *
 * 前置：dev server 跑在 localhost:5173，后端 8080
 * 运行：cd tests/.pw && node verify-ep-ondemand.js
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const API = 'http://127.0.0.1:8080/api'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'

const ROUTES = [
  '/', '/games', '/game/2', '/board/1', '/post/3019', '/search?keyword=原神',
  '/user/2', '/tag/1', '/announcements', '/agreement', '/privacy',
  '/editor', '/my', '/subscribe', '/messages', '/notifications', '/my-reports', '/admin'
]

// 硬失败：只认「按需引入漏注册」的信号（组件/指令没解析出来 = 本次改造引入的回归）
const HARD = /Failed to resolve component|Failed to resolve directive/
// 参考项：项目既有的其它 Vue 告警（如模板引用了未定义变量），不属于本次改造范围，仅记录
const SOFT = /Vue warn|is not defined/

;(async () => {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123456' })
  }).then((r) => r.json())
  const token = login.data.token

  const b = await chromium.launch({ executablePath: EXE, headless: true })
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await c.addInitScript(
    ([t, u]) => {
      if (!localStorage.getItem('token')) {
        localStorage.setItem('token', t)
        localStorage.setItem('userInfo', u)
      }
    },
    [token, JSON.stringify(login.data.user)]
  )
  const p = await c.newPage()

  const hard = [] // 本次改造引入的回归（硬失败）
  const soft = [] // 项目既有的其它 Vue 告警（仅记录，不判失败）
  const allWarn = []
  p.on('console', (m) => {
    const t = m.type()
    if (t !== 'warning' && t !== 'error') return
    const text = m.text()
    if (/favicon/.test(text)) return
    allWarn.push(`[${t}] ${text}`)
    if (HARD.test(text)) hard.push(`[${t}] ${text}`)
    else if (SOFT.test(text)) soft.push(`[${t}] ${text}`)
  })
  p.on('pageerror', (e) => { hard.push(`[pageerror] ${e.message}`) })

  const checks = []
  const check = (n, ok, extra = '') => checks.push([n, ok, extra])

  const dismissAnno = async () => {
    const el = await p.$('.anno-close')
    if (el) { await el.click().catch(() => {}); await p.waitForTimeout(250) }
  }

  // ---------- A. 全站路由巡检 ----------
  console.log('\nA. 全站路由巡检（抓未注册组件 / 指令）')
  for (const r of ROUTES) {
    const n0 = hard.length
    await p.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await p.waitForTimeout(1500)
    await dismissAnno()
    const added = hard.length - n0
    console.log(`  ${added === 0 ? '✅' : '❌'} ${r}${added ? ' —— ' + added + ' 条问题' : ''}`)
  }
  check('全站无「未注册组件 / 指令」告警', hard.length === 0,
    hard.length ? hard.slice(0, 3).join(' || ') : `${ROUTES.length} 个路由全干净`)

  // ---------- B. Element 基础样式是否在 ----------
  console.log('\nB. Element 样式供给')
  await p.goto(`${BASE}/post/3019`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(1500)
  await dismissAnno()

  const styleInfo = await p.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const btn = document.querySelector('.el-button')
    return {
      primary: root.getPropertyValue('--el-color-primary').trim(),
      btnRadius: btn ? getComputedStyle(btn).borderRadius : null,
      btnDisplay: btn ? getComputedStyle(btn).display : null
    }
  })
  check('Element 基础变量已注入（--el-color-primary）', !!styleInfo.primary, styleInfo.primary)
  check('el-button 样式生效（flex 布局 + 非零圆角）',
    !!styleInfo.btnDisplay && styleInfo.btnDisplay.includes('flex') && !!styleInfo.btnRadius && styleInfo.btnRadius !== '0px',
    `display=${styleInfo.btnDisplay} radius=${styleInfo.btnRadius}`)

  // ---------- C. ElMessage 按需 API ----------
  console.log('\nC. ElMessage（AutoImport 注入 + 样式）')
  const favBtn = await p.$('.d-actions .el-button:nth-of-type(2)')
  check('详情页操作栏按钮存在', !!favBtn)
  if (favBtn) {
    await favBtn.click()
    let msgText = ''
    for (let i = 0; i < 24; i++) {
      await p.waitForTimeout(200)
      msgText = await p.$eval('.el-message', (el) => el.innerText).catch(() => '')
      if (msgText) break
    }
    check('点击收藏弹出 ElMessage 提示', !!msgText, msgText.slice(0, 24))
    const msgStyle = await p.$eval('.el-message', (el) => getComputedStyle(el).position).catch(() => '')
    check('ElMessage 样式生效（position=fixed）', msgStyle === 'fixed', msgStyle)
  }

  // ---------- D. ElMessageBox 按需 API ----------
  console.log('\nD. ElMessageBox（退出登录二次确认）')
  const logoutBtn = await p.$('.logout-item')
  check('侧栏退出登录按钮存在', !!logoutBtn)
  if (logoutBtn) {
    await logoutBtn.click()
    let boxTitle = ''
    for (let i = 0; i < 24; i++) {
      await p.waitForTimeout(200)
      boxTitle = await p.$eval('.el-message-box__header', (el) => el.innerText).catch(() => '')
      if (boxTitle) break
    }
    check('ElMessageBox 弹窗出现（无 ReferenceError）', !!boxTitle, boxTitle.trim().slice(0, 20))
    // 取消，不真的登出
    const cancel = await p.$('.el-message-box__btns button')
    if (cancel) await cancel.click().catch(() => {})
    await p.waitForTimeout(400)
  }

  // ---------- E. 收尾 ----------
  console.log('\nE. 汇总')
  check('全程无 pageerror', hard.filter((x) => x.startsWith('[pageerror]')).length === 0,
    hard.filter((x) => x.startsWith('[pageerror]')).slice(0, 2).join(' || '))

  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(2000)
  await p.screenshot({ path: 'ep-ondemand-home.png' })

  let pass = 0
  for (const [n, ok, extra] of checks) {
    console.log(`  ${ok ? '✅' : '❌'} ${n}${extra ? ' —— ' + extra : ''}`)
    if (ok) pass++
  }
  if (soft.length) {
    const uniq = [...new Set(soft.map((w) => w.replace(/\s+/g, ' ').slice(0, 110)))]
    console.log(`\n（参考·非本次改造引入）项目既有 Vue 告警 ${soft.length} 条，去重后 ${uniq.length} 类：`)
    uniq.slice(0, 6).forEach((w) => console.log('   ' + w))
  }
  console.log(`\n=== Element 按需引入冒烟：${pass}/${checks.length} 通过 ===`)
  await b.close()
  process.exit(pass === checks.length ? 0 : 1)
})().catch((e) => { console.error(e.message); process.exit(1) })

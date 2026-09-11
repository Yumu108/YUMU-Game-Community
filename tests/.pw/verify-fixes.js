/**
 * 缺陷修复验证 —— goMy 未定义 / pageSize 大小写 + 后端 total 截断
 *
 * 背景（2026-09-10 修复）：
 *   缺陷1 `TopBar.vue` 💎「我的积分」@click="goMy"，但只定义了 goMine/goMyReports → 点击报错不跳转。
 *   缺陷2 `Home.vue`/`Board.vue` 模板写 `pageSize`，脚本常量叫 `PAGE_SIZE` → 未定义标识符 + 分页条恒隐藏。
 *         同时后端 `PostServiceImpl` 把 latest/hot/reply/favorite 的 total 截断到一页以「隐藏分页」，
 *         二者叠加导致 189 条帖永远看不到分页。本次一并放开为真实分页。
 *
 * 前置：前端跑在 localhost:5173（dev 或 preview 均可，CORS 白名单只放行 5173），后端 8080
 * 运行：cd tests/.pw && node verify-fixes.js
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const API = 'http://127.0.0.1:8080/api'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'

;(async () => {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') })
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

  const warns = []
  const pageErrors = []
  p.on('console', (m) => {
    const t = m.type()
    if (t !== 'warning' && t !== 'error') return
    const text = m.text()
    if (/favicon/.test(text)) return
    warns.push(text)
  })
  p.on('pageerror', (e) => pageErrors.push(e.message))

  const checks = []
  const check = (n, ok, extra = '') => checks.push([n, ok, extra])

  const dismissAnno = async () => {
    const el = await p.$('.anno-close')
    if (el) { await el.click().catch(() => {}); await p.waitForTimeout(250) }
  }

  // 读当前 feed 第一条帖的标题（用标题比对翻页是否真的换了内容）
  const firstTitle = () => p.$eval('.feed article.post .p-title', (el) => el.innerText.trim()).catch(() => '')
  const pageCells = () => p.$$eval('.pager .el-pager li.number', (els) => els.map((e) => e.innerText.trim()))
  const activePage = () => p.$eval('.pager .el-pager li.is-active', (el) => el.innerText.trim()).catch(() => '')

  // ================= A. 缺陷1：顶栏 💎 积分 chip → /my =================
  console.log('\nA. 缺陷1 · 顶栏「我的积分」跳转')
  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(2000)
  await dismissAnno()

  const chip = await p.$('.points-chip')
  check('顶栏 💎 积分 chip 存在', !!chip)
  if (chip) {
    const errN0 = pageErrors.length
    await chip.click()
    await p.waitForTimeout(1200)
    const url = p.url()
    check('点击后跳转到 /my', /\/my(\?|$)/.test(url), url.replace(BASE, '') || url)
    check('点击未产生 JS 报错（goMy 已定义）', pageErrors.length === errN0,
      pageErrors.slice(errN0).join(' || '))
    // /my 页面应出现积分区块
    await p.waitForTimeout(800)
    const hasPoints = await p.$eval('.my', () => !!document.querySelector('.my')).catch(() => false)
    check('已进入个人中心（.my 渲染）', !!hasPoints)
  }

  // ================= B. 缺陷2：首页分页 =================
  console.log('\nB. 缺陷2 · 首页分页条出现且可翻页')
  const homeWarnN0 = warns.length
  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(2500)
  await dismissAnno()

  // 等 feed 出帖
  await p.waitForSelector('.feed article.post', { timeout: 15000 }).catch(() => {})
  const pager = await p.$('.pager')
  check('首页分页条已渲染（.pager）', !!pager)

  const cells = await pageCells()
  check('分页页码 >= 2（189 帖 / 每页 10）', cells.length >= 2, `页码: ${cells.slice(0, 6).join(',')}`)

  const t1 = await firstTitle()
  const act1 = await activePage()
  check('第 1 页有帖且当前页=1', !!t1 && act1 === '1', `title="${t1.slice(0, 18)}" active=${act1}`)

  // 点第 2 页
  const p2 = await p.$('.pager .el-pager li.number:nth-child(2)')
  if (p2) {
    await p2.click()
    await p.waitForTimeout(2200)
    const t2 = await firstTitle()
    const act2 = await activePage()
    check('点第 2 页后当前页=2', act2 === '2', `active=${act2}`)
    check('第 2 页内容与第 1 页不同（真的翻页了）', !!t2 && t2 !== t1,
      `p1="${t1.slice(0, 16)}" → p2="${t2.slice(0, 16)}"`)
  } else {
    check('点第 2 页后当前页=2', false, '未找到第 2 页按钮')
    check('第 2 页内容与第 1 页不同（真的翻页了）', false, '未找到第 2 页按钮')
  }

  const homeUndef = warns.slice(homeWarnN0).filter((w) => /pageSize/.test(w))
  check('首页无「pageSize 未定义」告警', homeUndef.length === 0,
    homeUndef.slice(0, 2).join(' || ') || '无')

  // ================= C. 缺陷2：板块页分页 =================
  console.log('\nC. 缺陷2 · 板块页分页条出现且可翻页（/board/1 有 81 帖）')
  const boardWarnN0 = warns.length
  await p.goto(`${BASE}/board/1`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(2500)
  await dismissAnno()

  await p.waitForSelector('.feed article.post', { timeout: 15000 }).catch(() => {})
  const bpager = await p.$('.pager')
  check('板块页分页条已渲染（.pager）', !!bpager)

  const bcells = await pageCells()
  check('板块页页码 >= 2（81 帖 / 每页 10）', bcells.length >= 2, `页码: ${bcells.slice(0, 6).join(',')}`)

  const bt1 = await firstTitle()
  const bp2 = await p.$('.pager .el-pager li.number:nth-child(2)')
  if (bp2) {
    await bp2.click()
    await p.waitForTimeout(2200)
    const bt2 = await firstTitle()
    check('板块页翻到第 2 页内容不同', !!bt2 && bt2 !== bt1,
      `p1="${bt1.slice(0, 16)}" → p2="${bt2.slice(0, 16)}"`)
  } else {
    check('板块页翻到第 2 页内容不同', false, '未找到第 2 页按钮')
  }

  const boardUndef = warns.slice(boardWarnN0).filter((w) => /pageSize/.test(w))
  check('板块页无「pageSize 未定义」告警', boardUndef.length === 0,
    boardUndef.slice(0, 2).join(' || ') || '无')

  await p.screenshot({ path: 'fix-pagination-board.png' })

  // ================= D. 汇总 =================
  console.log('\nD. 汇总')
  check('全程无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' || '))

  let pass = 0
  for (const [n, ok, extra] of checks) {
    console.log(`  ${ok ? '✅' : '❌'} ${n}${extra ? ' —— ' + extra : ''}`)
    if (ok) pass++
  }
  console.log(`\n=== 缺陷修复验证：${pass}/${checks.length} 通过 ===`)
  await b.close()
  process.exit(pass === checks.length ? 0 : 1)
})().catch((e) => { console.error(e.message); process.exit(1) })

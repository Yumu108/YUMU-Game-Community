// 用法：node verify-game-admin.js
// 作用（9-11）：游戏库「默认名称拼音序」+ 后台游戏表单「平台/类型选择项化（含其他）」的 UI 回归。
//   ① /games 卡片顺序 = 拼音升序（中文在前按拼音、英文在后按字母，对齐 MySQL utf8mb4_zh_0900_as_cs）
//   ② /games 筛选下拉 = 固定清单（含「其他」）∪ 库内历史值（如「移动」）
//   ③ /admin 游戏管理：列表行不再显示人工排序值；新建/编辑弹窗的平台与类型是下拉选择
//   ④ 新建弹窗：平台下拉 = PC/主机/手机/多平台/其他；可选中「其他」
//   ⑤ 编辑旧游戏（类型不在新清单，如 RPG）：旧值被动态追加为可选项，原样保留可保存
//   ⑥ 全程无 pageerror / console error
// 依赖：前端 5173（dev 或 preview）+ 后端 8080
const { chromium } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP = process.env.WEB_BASE || 'http://localhost:5173'
const API = process.env.YUMU_HOST || 'http://localhost:8080/api'
const OUT = path.resolve(__dirname, '../../docs/screenshots')

let pass = 0, fail = 0
const failures = []
function ok (cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`) }
}
function section (t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`) }

// 与 MySQL utf8mb4_zh_0900_as_cs 对齐：中文段在前按拼音，英文段在后按字母
const zh = new Intl.Collator(['zh-Hans-CN', 'en'], { sensitivity: 'base' })
const isHan = (s) => /^[\u2e80-\u9fff\uf900-\ufaff]/.test(s)
const cmpZh = (a, b) => {
  const ca = isHan(a) ? 0 : 1
  const cb = isHan(b) ? 0 : 1
  if (ca !== cb) return ca - cb
  return zh.compare(a, b)
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })

  // 管理员登录态（复用 verify-audit-tab.js 的方式）
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123456' })
  }).then((r) => r.json())
  const token = loginRes?.data?.token
  await ctx.addInitScript(
    ([t, u]) => {
      if (!localStorage.getItem('token')) {
        localStorage.setItem('token', t)
        localStorage.setItem('userInfo', u)
      }
    },
    [token, JSON.stringify(loginRes.data.user)]
  )

  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()) })

  const dismissAnno = async () => {
    for (let i = 0; i < 3; i++) {
      const btn = await page.$('.anno-modal .anno-close')
      if (!btn) return
      await btn.click().catch(() => {})
      await page.waitForTimeout(350)
    }
  }
  const go = async (url, wait = 2000) => {
    await page.goto(APP + url, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(wait)
    await dismissAnno()
  }
  /** 读当前可见下拉的全部选项文本 */
  const visibleOptions = async () =>
    page.$$eval('.el-select-dropdown:visible .el-select-dropdown__item', (els) =>
      els.map((e) => e.textContent.trim())
    )

  console.log('═'.repeat(66))
  console.log(' 游戏库排序 + 后台游戏表单选择项化 —— UI 回归')
  console.log('═'.repeat(66))

  // ---------------------------------------------------------- ① ② 游戏库
  section('① 游戏库默认顺序（拼音升序）')
  await go('/games')
  await page.waitForSelector('.g-card .g-name', { timeout: 12000 })
  const cardNames = await page.$$eval('.g-card .g-name', (els) => els.map((e) => e.textContent.trim()))
  ok(cardNames.length >= 12, '游戏卡片渲染', `${cardNames.length} 张`)
  const sortedCopy = [...cardNames].sort(cmpZh)
  ok(JSON.stringify(cardNames) === JSON.stringify(sortedCopy), '卡片顺序为名称拼音升序',
    cardNames.slice(0, 3).join(' / ') + ' …')
  ok(!cardNames.includes('其他游戏') || cardNames.indexOf('其他游戏') !== 0, '「其他游戏」不再霸占首位')

  section('② 筛选下拉 = 固定清单 ∪ 历史值')
  const platSel = page.locator('.g-filters .el-select').first()
  await platSel.click()
  await page.waitForTimeout(500)
  const platOpts = await visibleOptions()
  ok(['PC', '主机', '手机', '多平台', '其他'].every((o) => platOpts.includes(o)),
    '平台下拉含固定 5 项（含「其他」）', platOpts.join('、'))
  ok(platOpts.includes('移动'), '平台下拉保留历史值「移动」（旧数据仍可筛）')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  const genreSel = page.locator('.g-filters .el-select').nth(1)
  await genreSel.click()
  await page.waitForTimeout(500)
  const genreOpts = await visibleOptions()
  ok(genreOpts.includes('其他'), '类型下拉含「其他」')
  ok(['角色扮演', '动作', '射击', 'MOBA'].every((o) => genreOpts.includes(o)), '类型下拉含固定清单项')
  ok(genreOpts.includes('RPG') && genreOpts.includes('魂类'), '类型下拉保留历史值（RPG / 魂类）',
    `${genreOpts.length} 项`)
  await page.keyboard.press('Escape')
  await page.screenshot({ path: path.join(OUT, 'game-admin-library.png') })
  ok(fs.existsSync(path.join(OUT, 'game-admin-library.png')), '截图 game-admin-library.png')

  // ---------------------------------------------------------- ③ 后台列表
  section('③ 后台游戏管理列表（去掉人工排序展示）')
  await go('/admin')
  const gamesTab = page.locator('.el-tabs__item', { hasText: '游戏管理' }).first()
  ok((await gamesTab.count()) > 0, '「游戏管理」Tab 存在')
  await gamesTab.click()
  await page.waitForTimeout(1600)
  const rowTexts = await page.$$eval('.games-section .a-item', (els) => els.map((e) => e.textContent))
  ok(rowTexts.length >= 12, '游戏列表渲染', `${rowTexts.length} 行`)
  ok(rowTexts.every((t) => !/排序\s*\d/.test(t)), '列表行不再显示人工排序值')
  const rowNames = await page.$$eval('.games-section .a-item .a-g-name', (els) =>
    els.map((e) => e.textContent.trim())
  )
  const adminSorted = [...rowNames].sort(cmpZh)
  ok(rowNames.length >= 12 && JSON.stringify(rowNames) === JSON.stringify(adminSorted),
    '后台列表顺序为名称拼音升序', rowNames.slice(0, 3).join(' / ') + ' …')

  // ---------------------------------------------------------- ④ 新建弹窗
  section('④ 新建游戏：平台 / 类型为下拉选择（含其他）')
  await page.locator('.games-section button', { hasText: '新建游戏' }).first().click()
  await page.waitForSelector('.el-dialog', { timeout: 8000 })
  await page.waitForTimeout(600)
  const dialog = page.locator('.el-dialog').last()
  const formItems = dialog.locator('.el-form-item')
  const platItem = formItems.filter({ hasText: '平台' }).first()
  const genreItem = formItems.filter({ hasText: '类型' }).first()
  ok((await platItem.locator('.el-select').count()) === 1, '平台是下拉选择（el-select）')
  ok((await platItem.locator('input[placeholder*="如"]').count()) === 0, '平台不再是自由文本输入')
  ok((await genreItem.locator('.el-select').count()) === 1, '类型是下拉选择（el-select）')
  ok((await dialog.locator('.el-input-number').count()) === 0, '人工排序数字框已移除')
  ok((await formItems.filter({ hasText: '排序' }).count()) === 0, '「排序」表单项已移除')

  await platItem.locator('.el-select').click()
  await page.waitForTimeout(500)
  const dialogPlatOpts = await visibleOptions()
  ok(JSON.stringify(dialogPlatOpts) === JSON.stringify(['PC', '主机', '手机', '多平台', '其他']),
    '平台下拉恰好为固定 5 项', dialogPlatOpts.join('、'))
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item', { hasText: '其他' }).first().click()
  await page.waitForTimeout(300)
  const platVal = (await platItem.locator('.el-select').innerText()).trim()
  ok(platVal === '其他', '「其他」可被选中', `当前值=${platVal}`)

  await genreItem.locator('.el-select').click()
  await page.waitForTimeout(500)
  const dialogGenreOpts = await visibleOptions()
  ok(dialogGenreOpts.includes('其他') && dialogGenreOpts.includes('角色扮演'), '类型下拉含固定清单与「其他」',
    `${dialogGenreOpts.length} 项`)
  await page.keyboard.press('Escape')
  await page.screenshot({ path: path.join(OUT, 'game-admin-form-new.png') })
  // 取消新建，不留数据
  await page.locator('.el-dialog button', { hasText: '取消' }).first().click()
  await page.waitForTimeout(500)

  // ---------------------------------------------------------- ⑤ 编辑旧游戏
  section('⑤ 编辑旧游戏：清单外旧值动态兼容')
  const legacyRow = page.locator('.games-section .a-item', { hasText: '崩坏：星穹铁道' }).first()
  ok((await legacyRow.count()) > 0, '找到旧取值游戏（崩坏：星穹铁道 · RPG）')
  await legacyRow.locator('button', { hasText: '编辑' }).click()
  await page.waitForTimeout(700)
  const dlg2 = page.locator('.el-dialog').last()
  const dlg2Genre = dlg2.locator('.el-form-item').filter({ hasText: '类型' }).first()
  await dlg2Genre.locator('.el-select').click()
  await page.waitForTimeout(500)
  const legacyOpts = await visibleOptions()
  ok(legacyOpts.includes('RPG'), '旧值 RPG 被动态追加为可选项', legacyOpts.join('、'))
  const dlg2Plat = dlg2.locator('.el-form-item').filter({ hasText: '平台' }).first()
  const curPlat = (await dlg2Plat.locator('.el-select').innerText()).trim()
  ok(curPlat === '多平台', '旧值在清单内时正常回显', `当前平台=${curPlat}`)
  await page.keyboard.press('Escape')
  await page.screenshot({ path: path.join(OUT, 'game-admin-form-edit-legacy.png') })
  await page.locator('.el-dialog button', { hasText: '取消' }).first().click()
  await page.waitForTimeout(400)

  // ---------------------------------------------------------- ⑥ 运行时错误
  section('⑥ 运行时错误')
  const realErrors = errors.filter((e) => !e.includes('favicon'))
  ok(realErrors.length === 0, '无 pageerror / console error', realErrors.slice(0, 3).join(' | '))

  console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══`)
  if (fail) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exitCode = 1 }
  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })

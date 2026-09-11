/**
 * 审计日志 Tab —— 浏览器冒烟（playwright-core + 系统 Chrome）
 *
 * 背景：027 给 /admin 新增了「审计日志」Tab（Admin.vue + 两个新接口）。
 *   接口测试（audit-log-verify.mjs 28 项）只覆盖后端；前端「模板引用未定义变量」
 *   「新组件渲染报错」这类问题只有真跑浏览器才会暴露 —— 本项目历史上已踩过
 *   `FENCE is not defined` 长期无人发现的坑，故新增页签必须补一条 UI 冒烟。
 *
 * 前置：前端 5173（npm run preview）+ 后端 8080
 * 运行：cd tests/.pw && node verify-audit-tab.js
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

  const errors = []
  p.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  p.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/favicon/.test(t)) return
    errors.push(`[console.error] ${t}`)
  })

  const checks = []
  const check = (n, ok, extra = '') => {
    checks.push([n, ok, extra])
    console.log(ok ? '  ✅' : '  ❌', n, extra ? `—— ${extra}` : '')
  }

  const dismissAnno = async () => {
    const el = await p.$('.anno-close')
    if (el) { await el.click().catch(() => {}); await p.waitForTimeout(250) }
  }

  try {
    await p.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' })
    await p.waitForTimeout(900)
    await dismissAnno()

    console.log('\n[1] 审计日志 Tab 存在且可切换')
    const tab = p.locator('.el-tabs__item', { hasText: '审计日志' }).first()
    check('Tab 渲染', (await tab.count()) > 0)
    await tab.click()
    await p.waitForTimeout(1400)
    const section = p.locator('.audit-section')
    check('切换后 section 可见', await section.isVisible().catch(() => false))

    console.log('\n[2] 筛选控件齐备')
    check('动作码下拉', (await section.locator('.el-select').count()) >= 2)
    check('操作人输入框', (await section.locator('input[placeholder*="操作人"]').count()) >= 1)
    check('时间范围选择器', (await section.locator('.el-date-editor').count()) >= 1)
    check('查询/重置/刷新按钮', (await section.locator('button').count()) >= 3)

    console.log('\n[3] 列表渲染与中文标签')
    const items = section.locator('.audit-item')
    const n = await items.count()
    check('有审计记录渲染', n > 0, `items=${n}`)
    if (n > 0) {
      const label = (await items.first().locator('.el-tag').first().textContent()) || ''
      check('动作为中文标签（非英文动作码）', /[\u4e00-\u9fa5]/.test(label), `label=${label.trim()}`)
      const detail = (await items.first().locator('.audit-detail').textContent()) || ''
      check('详情文本非空', detail.trim().length > 0, detail.trim().slice(0, 40))
      const top = (await items.first().locator('.a-item-top').textContent()) || ''
      check('显示操作人与时间', /\d{4}-\d{2}-\d{2}/.test(top), top.replace(/\s+/g, ' ').trim().slice(0, 60))
    }

    console.log('\n[4] 动作码筛选真实联动')
    const sel = section.locator('.el-select').first()
    await sel.click()
    await p.waitForTimeout(500)
    const opt = p.locator('.el-select-dropdown__item:visible').first()
    const optText = ((await opt.textContent().catch(() => '')) || '').trim()
    check('下拉有动作码选项', optText.length > 0, optText)
    if (optText.length > 0) {
      await opt.click()
      await p.waitForTimeout(1200)
      const filtered = await section.locator('.audit-item').count()
      const emptyShown = await section.locator('.a-empty').count()
      check('筛选后列表正常响应（有数据或空态，无报错）', filtered > 0 || emptyShown > 0,
            `items=${filtered} empty=${emptyShown}`)
    }

    console.log('\n[5] 重置筛选')
    const resetBtn = section.locator('button', { hasText: '重置' }).first()
    if (await resetBtn.count()) {
      await resetBtn.click()
      await p.waitForTimeout(1200)
      const back = await section.locator('.audit-item').count()
      check('重置后恢复全量列表', back > 0, `items=${back}`)
    }

    console.log('\n[6] 无运行时报错')
    check('全程无 pageerror / console.error', errors.length === 0, errors.slice(0, 3).join(' | '))
  } catch (e) {
    check('脚本执行未抛异常', false, e.message)
  }

  const fail = checks.filter(([, ok]) => !ok).length
  console.log(`\n=== 审计日志 Tab 冒烟：${checks.length - fail}/${checks.length} 通过 ===`)
  await b.close()
  if (fail > 0) process.exitCode = 1
})()

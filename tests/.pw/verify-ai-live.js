/**
 * 智能助手「真实大模型」UI 冒烟（playwright-core + 系统 Chrome）
 *
 * 目的：接口层已验证后端能直连 DeepSeek（见 tests/ai-deepseek-live-verify.mjs），
 *       本脚本验证「浏览器里点一下」也能走通——覆盖 SSE 在前端 fetch 流式解析、
 *       逐块渲染进 .ai-md、发送按钮 streaming 期间禁用/恢复 这条完整链路。
 *
 * 前置：后端 8080 以 LLM_MOCK=false + 真实 LLM_API_KEY 启动；dev server 在 localhost:5173
 * 运行：cd tests/.pw && node verify-ai-live.js
 * 产出：docs/screenshots/ai-live*.png
 */
const { chromium } = require('playwright-core')
const fs = require('fs')
const path = require('path')

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const API = 'http://127.0.0.1:8080/api'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'
const SHOT = path.resolve(__dirname, '../../docs/screenshots')

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}

;(async () => {
  if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true })

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
    [token, JSON.stringify(login.data.user || {})]
  )
  const p = await c.newPage()

  const errors = []
  p.on('pageerror', (e) => errors.push(String(e)))

  const dismissAnno = async () => {
    const el = await p.$('.anno-close')
    if (el) { await el.click().catch(() => {}); await p.waitForTimeout(250) }
  }

  // ---------- 1. 唤起助手 ----------
  console.log('\n1. 唤起助手面板')
  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(2000)
  await dismissAnno()

  await p.click('.ai-fab')
  await p.waitForSelector('.ai-panel', { timeout: 5000 })
  check('点击悬浮球后助手面板打开', true)
  check('面板标题正确', (await p.textContent('.ai-name'))?.includes('YUMU'))

  // ---------- 2. 提问 + 流式回答 ----------
  console.log('\n2. 提问并等待流式回答')
  const QUESTION = 'YUMU 社区支持哪几种登录方式？'
  await p.fill('.ai-input textarea', QUESTION)
  await p.click('.ai-send')

  // 发送后按钮应立即进入 streaming 禁用态（前端 streaming 标志生效）
  await p.waitForTimeout(600)
  const disabledDuringStream = await p.$eval('.ai-send', (el) => el.disabled).catch(() => false)
  check('流式期间发送按钮禁用（防重复提交）', disabledDuringStream)

  // 轮询等待回答文本稳定
  let text = '', prev = '', stable = 0
  for (let i = 0; i < 60; i++) {
    await p.waitForTimeout(500)
    text = (await p.textContent('.ai-bubble.assistant .ai-md').catch(() => '')) || ''
    if (text && text === prev) { stable++; if (stable >= 3) break }
    else stable = 0
    prev = text
  }

  check('助手气泡出现正文', text.length > 0, `${text.length} 字`)
  check('发送按钮已恢复（streaming 结束）',
    !(await p.$eval('.ai-send', (el) => el.disabled).catch(() => true)))
  check('★ 真实模型回答（不含「本地模拟模式」文案）', !text.includes('本地模拟模式'))
  console.log(`  回答摘要：${text.slice(0, 140).replace(/\n/g, ' ')}`)

  await p.screenshot({ path: path.join(SHOT, 'ai-live.png'), fullPage: false })

  // ---------- 3. 多轮追问 ----------
  console.log('\n3. 多轮追问（沿用同一会话）')
  await p.fill('.ai-input textarea', '我刚才问的是什么？简短回答。')
  await p.click('.ai-send')
  let t2 = '', pr2 = '', st2 = 0
  for (let i = 0; i < 60; i++) {
    await p.waitForTimeout(500)
    const all = await p.$$eval('.ai-bubble.assistant .ai-md', (els) => els.map((e) => e.textContent))
    t2 = all[all.length - 1] || ''
    if (t2 && t2 === pr2) { st2++; if (st2 >= 3) break }
    else st2 = 0
    pr2 = t2
  }
  check('第二轮有回答', t2.length > 0, `${t2.length} 字`)
  check('多轮记忆生效（记得上一问）', /登录/.test(t2))
  await p.screenshot({ path: path.join(SHOT, 'ai-live-multi.png'), fullPage: false })

  check('页面无未捕获 JS 异常', errors.length === 0, errors.slice(0, 2).join(' || '))

  await b.close()
  console.log(`\n${'='.repeat(48)}`)
  console.log(`结果：${pass} 通过 / ${fail} 失败`)
  console.log('='.repeat(48))
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error('脚本异常：', e); process.exit(1) })

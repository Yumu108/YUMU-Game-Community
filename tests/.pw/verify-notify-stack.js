/**
 * 通知弹窗「不堆叠」回归（9-16 新增；对应反馈：右上角弹窗又肥又大、一次弹好几条）。
 *
 *   A 突发多条私信 → 屏幕上同时存在的通知 **最多 1 条**
 *   B 通知卡片本身**高度正常**（不被撑成空白大块）
 *   C 内容正确（标题「新私信」+ 发信人名与内容）
 *   D 过一会儿自动消失，屏幕回到干净状态
 *
 * 用法：node verify-notify-stack.js
 *   前置：① 5173 dev server 在跑（或 WEB_BASE 指过去）
 *         ② 8080 在跑，且带测试通道（造账号要用固定验证码）：
 *            MAIL_ENABLED=false MAIL_TEST_CODE=123456 MAIL_CODE_COOLDOWN=3 \
 *              MAIL_CODE_IP_PER_HOUR=100 java -jar backend/target/yumu-community-1.0.0.jar --server.port=8080
 *   可选环境变量：WEB_BASE / API_BASE / MAIL_TEST_CODE
 *
 *   本脚本会真造 2 个 `notifyprobe_` 前缀账号并互发几条私信（库里有痕迹，可按前缀清理）。
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'
const API = process.env.API_BASE || 'http://localhost:8080/api'
const TEST_CODE = (process.env.MAIL_TEST_CODE || '123456').trim()
const PW = 'pass123456'

let pass = 0, fail = 0
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('✅', msg) } else { fail++; console.log('❌', msg) }
}
const rnd = () => Math.floor(Math.random() * 250)
const nextIp = () => `10.${rnd()}.${rnd()}.${rnd()}`

async function api(method, path, body, token) {
  const r = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': nextIp(),
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  return r.json().catch(() => ({}))
}

async function makeUser(tag) {
  // ⚠️ 账号名上限 20 字符（后端 username 校验），前缀别写太长
  const u = `ntfprob_${tag}_${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 4)}`
  const mail = `${u}@qq.com`
  await api('POST', '/auth/email-code', { email: mail, scene: 'register' })
  const reg = await api('POST', '/auth/register', { username: u, password: PW, email: mail, emailCode: TEST_CODE })
  if (reg.code !== 200) return { u, err: `注册失败 ${reg.code} ${reg.message}` }
  const login = await api('POST', '/auth/login', { username: u, password: PW })
  if (login.code !== 200) return { u, err: `登录失败 ${login.code} ${login.message}` }
  return { u, mail, id: login.data?.user?.id, token: login.data?.token }
}

/** 数当前屏幕上的通知卡片，并返回每条的高度/文本，供「肥大」判定用 */
const probeNotifications = (page) => page.evaluate(() => {
  const list = [...document.querySelectorAll('.el-notification')]
  return list.map((el) => {
    const r = el.getBoundingClientRect()
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      visible: r.width > 0 && r.height > 0
    }
  })
})

;(async () => {
  console.log('--- 0. 造 2 个 probe 账号（A 收信 / B 发信）---')
  const A = await makeUser('a')
  const B = await makeUser('b')
  for (const [n, x] of [['A', A], ['B', B]]) {
    if (x.err) { console.log(`❌ ${n} 准备失败：${x.err}`); console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`); process.exit(1) }
  }
  ok(!!(A.id && B.id), `0 两个账号就绪（A=${A.id} B=${B.id}，密码统一 ${PW}）`)

  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const errors = []
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text()) })

  // 页面登录 A，停在首页（**不进聊天页** → 私信通知应当弹出来）
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1000)
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1200)
  const inputs = page.locator('.login-card .el-input__inner')
  await inputs.nth(0).fill(A.u)
  await inputs.nth(1).fill(PW)
  await page.click('.submit')
  await page.waitForTimeout(2500)
  const logged = await page.evaluate(() => !!localStorage.getItem('token'))
  ok(logged, `0b A 已登录（token 已落 localStorage，当前 ${new URL(page.url()).pathname}）`)

  // 等 WS 连上（连不上则推送收不到，A 组会假失败）
  await page.waitForTimeout(1500)

  console.log('--- A. 突发 4 条私信 → 通知最多同时 1 条 ---')
  const stamp = Date.now().toString(36).slice(-4)
  for (let i = 1; i <= 4; i++) {
    await api('POST', '/messages', { toUserId: A.id, content: `STACK-${stamp}-${i}` }, B.token)
    await page.waitForTimeout(220)
  }
  await page.waitForTimeout(900) // 留出节流窗口

  const seen = await probeNotifications(page)
  await page.screenshot({ path: 'notify-stack-after.png', clip: { x: 860, y: 0, width: 420, height: 420 } }).catch(() => {})
  console.log('   通知明细：', JSON.stringify(seen))

  ok(seen.length <= 1, `A1 突发 4 条后屏幕上通知数 = ${seen.length}（要求 ≤ 1）`)
  ok(seen.every((n) => n.h <= 120), `A2 通知卡片高度正常（${seen.map((n) => n.h + 'px').join('/') || '无'}，要求 ≤ 120px）`)
  const joined = seen.map((n) => n.text).join(' | ')
  ok(seen.length === 0 || /新私信/.test(joined), `A3 通知内容含「新私信」标题（${joined.slice(0, 60)}）`)
  ok(seen.length === 0 || new RegExp(`STACK-${stamp}-4`).test(joined) || /STACK-/.test(joined),
    'A4 通知里带的是真实私信内容')

  console.log('--- B. 自动消失，屏幕回到干净状态 ---')
  await page.waitForTimeout(4200)
  const after = await probeNotifications(page)
  ok(after.length === 0, `B1 4.2s 后通知已全部消失（残留 ${after.length} 条）`)

  ok(errors.length === 0, `C1 无控制台硬错误（${errors.length} 条${errors.length ? '：' + errors[0] : ''}）`)

  await browser.close()
  console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
  process.exit(fail === 0 ? 0 : 1)
})()

/**
 * 私信「实时接收」回归（9-16 新增；对应反馈：聊天窗不能实时收到，必须返回再进才看得到）。
 *
 *   A 实时入流：对方发来的消息**不刷新页面**就出现在聊天流里（原先只有 TopBar 订阅 WS）
 *   B 不重复打扰：正开着与发信人的会话时**不弹**「新私信」通知（消息已在流里）
 *   C 其它会话照旧弹：正与 B 聊天时 C 发来消息 → 仍然弹通知（说明抑制只对该会话生效）
 *   D 会话列表实时：停留在列表页时收到消息 → 「最新一条」更新 + 未读徽标出现
 *   E 自己发送即时出现（本地入流，不等重拉）
 *   F 控制台无硬错误
 *
 * ⚠️ 架构前提（很重要，不然推送会「发出去但收不到」）：
 *   WebSocket 会话存在**各自进程的内存**里。页面（5173）经 Vite 代理把 /api 打到 8080，
 *   所以 A 的 WS 挂在 8080 上；**发消息的 API 也必须打 8080**，否则消息由 8081 进程发出，
 *   它内存里没有 A 的会话 → 推送直接丢弃（这正是本地调试时最容易踩的假失败）。
 *   而造账号需要 `MAIL_TEST_CODE` 测试通道，只能走 8081（8080 读用户 .env，测试码为空）。
 *   ⇒ 因此本脚本：**造账号用 SIGNUP_BASE(8081)，登录/发消息用 API_BASE(8080)**。
 *
 * 用法：node verify-chat-live.js
 *   前置：① 5173 dev server 在跑（或 WEB_BASE 指过去）
 *         ② 8080（用户的 start.bat 实例）在跑
 *         ③ 8081 带测试通道在跑：
 *            MAIL_ENABLED=false MAIL_TEST_CODE=123456 MAIL_CODE_COOLDOWN=3 MAIL_CODE_IP_PER_HOUR=100 \
 *              java -jar backend/target/yumu-community-1.0.0.jar --server.port=8081
 *   可选环境变量：WEB_BASE / API_BASE / SIGNUP_BASE / MAIL_TEST_CODE
 *
 *   本脚本会真造 3 个 `chatprobe_` 前缀账号并互发几条私信（库里有痕迹，可按前缀清理）。
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'
const API = process.env.API_BASE || 'http://localhost:8080/api'
const SIGNUP = process.env.SIGNUP_BASE || 'http://localhost:8081/api'
const TEST_CODE = (process.env.MAIL_TEST_CODE || '123456').trim()
const PW = 'pass123456'

let pass = 0, fail = 0
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('✅', msg) } else { fail++; console.log('❌', msg) }
}
const rnd = () => Math.floor(Math.random() * 250)
const nextIp = () => `10.${rnd()}.${rnd()}.${rnd()}`

async function api(base, method, path, body, token) {
  const r = await fetch(base + path, {
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

/** 造一个可用账号：8081 发码 + 注册（测试通道），再用 8080 登录拿 token（业务同进程）。 */
async function makeUser(tag) {
  const u = `chatprobe_${tag}_${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`
  const mail = `${u}@qq.com`
  await api(SIGNUP, 'POST', '/auth/email-code', { email: mail, scene: 'register' })
  const reg = await api(SIGNUP, 'POST', '/auth/register', { username: u, password: PW, email: mail, emailCode: TEST_CODE })
  if (reg.code !== 200) return { u, err: `注册失败 ${reg.code} ${reg.message}` }
  const login = await api(API, 'POST', '/auth/login', { username: u, password: PW })
  if (login.code !== 200) return { u, err: `登录失败 ${login.code} ${login.message}` }
  return { u, mail, id: login.data?.user?.id, token: login.data?.token }
}

;(async () => {
  console.log('--- 0. 造 3 个 probe 账号（A/B/C）---')
  const A = await makeUser('a')
  const B = await makeUser('b')
  const C = await makeUser('c')
  for (const [n, x] of [['A', A], ['B', B], ['C', C]]) {
    if (x.err) { console.log(`❌ ${n} 准备失败：${x.err}`); console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`); process.exit(1) }
  }
  ok(!!(A.id && B.id && C.id), `0 三个账号就绪（A=${A.id} B=${B.id} C=${C.id}，密码统一 ${PW}）`)

  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const errors = []
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text())
    if (m.type() === 'warning' && /Failed to resolve/.test(m.text())) errors.push('RESOLVE: ' + m.text())
  })

  // 页面登录 A（走 5173 → 8080）
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1200)
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1200)
  const inputs = page.locator('.login-card .el-input__inner')
  await inputs.nth(0).fill(A.u)
  await inputs.nth(1).fill(PW)
  await page.click('.submit')
  await page.waitForTimeout(2500)
  const logged = await page.evaluate(() => !!localStorage.getItem('token'))
  if (!logged) {
    console.log('❌ 页面登录失败（确认 5173 dev server 与 8080 后端在跑）')
    console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
    await browser.close()
    process.exit(1)
  }
  ok(true, `1 页面已以 A(${A.u}) 登录`)

  const bubbles = () => page.$$eval('.chat-body .bubble', (els) => els.map((e) => e.textContent.trim()))
  const notifTexts = () => page.$$eval('.el-notification', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')))
  const clearNotifs = () => page.evaluate(() => document.querySelectorAll('.el-notification').forEach((e) => e.remove()))

  console.log('--- A. 实时入流（不刷新页面）---')
  // 先让 B 发一条，保证会话存在（否则 A 直接进 /messages/<B> 时会话列表里没有它，peerName 取不到）
  const seed = `seed-${Date.now().toString(36)}`
  await api(API, 'POST', '/messages', { toUserId: A.id, content: seed }, B.token)
  await page.goto(`${BASE}/messages/${B.id}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(2500) // 等 WS 连上（TopBar 挂载后 connect）
  ok((await bubbles()).some((t) => t === seed), 'A1 进入会话后能看到历史消息（WS 就绪等待 2.5s）')

  const live = `live-${Date.now().toString(36)}`
  const before = (await bubbles()).length
  await api(API, 'POST', '/messages', { toUserId: A.id, content: live }, B.token)
  await page.waitForTimeout(2500)
  const after = await bubbles()
  ok(after.includes(live), `A2 对方发来的消息**未刷新页面**即出现在聊天流（"${live}"）`)
  ok(after.length === before + 1, `A3 只新增 1 条（无重复渲染）→ ${before} → ${after.length}`)
  ok(after.filter((t) => t === live).length === 1, 'A4 同一条消息不重复插入（按 messageId 去重）')

  console.log('--- B. 正在聊天时不弹通知 ---')
  const n = await notifTexts()
  ok(!n.some((t) => /新私信/.test(t)), `B1 正开着该会话 → 不弹「新私信」通知（弹窗：${n.length ? n.join(' | ') : '无'}）`)

  console.log('--- C. 自己发送即时出现 ---')
  await clearNotifs()
  const mine = `me-${Date.now().toString(36)}`
  await page.fill('.chat-input .el-input__inner', mine)
  await page.click('.chat-input .el-button')
  await page.waitForTimeout(1200)
  const afterMine = await bubbles()
  ok(afterMine.includes(mine), `C1 自己发的消息立即出现（本地入流，不等重拉）→ "${mine}"`)
  ok((await page.inputValue('.chat-input .el-input__inner')) === '', 'C2 发送后输入框已清空')

  console.log('--- D. 会话列表实时更新（未读徽标）---')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.chat-head button')].find((x) => /返回/.test(x.textContent))
    if (b) b.click()
  })
  await page.waitForTimeout(1800)
  const onList = (await page.$$('.conv')).length > 0
  ok(onList, 'D1 已返回会话列表')
  await clearNotifs()
  const listMsg = `list-${Date.now().toString(36)}`
  await api(API, 'POST', '/messages', { toUserId: A.id, content: listMsg }, B.token)
  await page.waitForTimeout(2500)
  const convLast = await page.$$eval('.conv-last', (els) => els.map((e) => e.textContent.trim()))
  ok(convLast.includes(listMsg), `D2 列表里「最新一条」实时更新为 "${listMsg}" → [${convLast.join(' / ')}]`)
  const badge = await page.$$eval('.conv .el-badge__content', (els) => els.filter((e) => e.style.display !== 'none').map((e) => e.textContent.trim()))
  ok(badge.length > 0, `D3 未读徽标出现 → [${badge.join(',')}]`)
  ok((await notifTexts()).some((t) => /新私信/.test(t)), 'D4 不在该会话里 → 照旧弹「新私信」通知')

  console.log('--- E. 抑制只对「当前会话」生效 ---')
  await clearNotifs()
  await page.goto(`${BASE}/messages/${B.id}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(2200)
  const cMsg = `c-${Date.now().toString(36)}`
  await api(API, 'POST', '/messages', { toUserId: A.id, content: cMsg }, C.token)
  await page.waitForTimeout(2500)
  const notifs = await notifTexts()
  ok(notifs.some((t) => /新私信/.test(t)), `E1 正与 B 聊天时 C 发来消息 → 仍弹通知（${notifs.join(' | ') || '无'}）`)
  ok(!(await bubbles()).includes(cMsg), 'E2 C 的消息没有混进与 B 的聊天流（未串会话）')

  console.log('--- F. 控制台 ---')
  ok(errors.length === 0, `F1 无 pageerror / 未注册组件告警（${errors.length} 条硬错误）`)
  if (errors.length) errors.slice(0, 5).forEach((e) => console.log('   ', e))

  console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
  console.log(`（probe 账号：${A.u} / ${B.u} / ${C.u}，可按 chatprobe_ 前缀清理）`)
  await browser.close()
  process.exit(fail ? 1 : 0)
})()

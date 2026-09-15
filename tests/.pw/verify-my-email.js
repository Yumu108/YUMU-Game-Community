/**
 * 个人中心「📧 绑定邮箱」区块回归（9-15 新增功能）
 *
 *   非破坏性：**只验证「拦得住」，不做任何真实绑定/更换**（admin 那种账号一旦被改邮箱，
 *   后续其它测试脚本的登录假设就全废了）。唯一会真发出去的是几封 mock 验证码（只打后端日志）。
 *
 *   A 区块渲染（标题 / 当前邮箱 / 新邮箱 / 验证码 / 提交按钮）
 *   B 未绑定账号的分支：显示「尚未绑定」+ 提交按钮为「绑定邮箱」+ 无「原邮箱验证码」
 *   C 前端拦截：缺新邮箱 / 邮箱格式错 / 缺 6 位验证码 / 验证码错（且**不得**改掉当前邮箱）
 *   D 已绑定账号的分支（脱敏邮箱 + 「原邮箱验证码」+ 提交按钮为「确认更换」+ 缺原邮箱码被拦）
 *       ⚠️ 需要后端开着自动化测试通道（MAIL_TEST_CODE）来造一个有邮箱的账号；
 *          通道没开时 D 组整体跳过，并打印原因（不算失败）。
 *   E 控制台无硬错误
 *
 * 用法：node verify-my-email.js
 *   可选环境变量：WEB_BASE（默认 http://localhost:5173）
 *                ADMIN_USER / TEST_ADMIN_PASSWORD（默认 admin / admin123456）
 *                API_BASE（默认 http://localhost:8080/api）
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'
const API = process.env.API_BASE || 'http://localhost:8080/api'
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PW = process.env.TEST_ADMIN_PASSWORD || 'admin123456'
const TEST_CODE = (process.env.MAIL_TEST_CODE || '123456').trim()

let pass = 0, fail = 0, skip = 0
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('✅', msg) } else { fail++; console.log('❌', msg) }
}
const skipped = (msg) => { skip++; console.log('⏭  SKIP:', msg) }

const clearMsgs = (page) => page.evaluate(() => document.querySelectorAll('.el-message').forEach((e) => e.remove()))
const lastMsg = (page) => page.evaluate(() => {
  const all = [...document.querySelectorAll('.el-message')]
  const last = all[all.length - 1]
  return last ? last.textContent.replace(/\s+/g, ' ').trim() : ''
})
/** 「📧 绑定邮箱」那块表单（它是 .settings 里的最后一个 .set-form 之外独有的那段） */
const emailBlock = (page) => page.locator('.pc-title:has-text("绑定邮箱")')
/** 邮箱区块内的输入框：已绑定时 = [原邮箱码, 新邮箱, 新邮箱码]；未绑定时 = [新邮箱, 新邮箱码] */
const emailInputs = (page) =>
  page.evaluate(() => {
    const title = [...document.querySelectorAll('.pc-title')].find((h) => /绑定邮箱/.test(h.textContent))
    if (!title) return []
    const form = title.closest('.el-form')
    if (!form) return []
    return [...form.querySelectorAll('.el-input__inner')].map((i) => i.placeholder)
  })
const clickEmailBtn = async (page, label) => {
  await page.evaluate((lb) => {
    const title = [...document.querySelectorAll('.pc-title')].find((h) => /绑定邮箱/.test(h.textContent))
    const form = title.closest('.el-form')
    const btn = [...form.querySelectorAll('button')].find((b) => b.textContent.trim().includes(lb))
    if (btn) btn.click()
  }, label)
  await page.waitForTimeout(700)
}
const fillEmailInput = async (page, idx, val) => {
  const handle = await page.evaluateHandle((i) => {
    const title = [...document.querySelectorAll('.pc-title')].find((h) => /绑定邮箱/.test(h.textContent))
    const form = title.closest('.el-form')
    return form.querySelectorAll('.el-input__inner')[i]
  }, idx)
  const el = handle.asElement()
  await el.fill(val)
  await page.waitForTimeout(150)
}

async function api(method, path, body, token) {
  const r = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.99`,
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  return r.json().catch(() => ({}))
}

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const errors = []
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text())
    if (m.type() === 'warning' && /Failed to resolve/.test(m.text())) errors.push('RESOLVE: ' + m.text())
  })

  const loginAs = async (user, pwd) => {
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(1200)
    await page.evaluate(() => { localStorage.clear() })
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(1200)
    const ins = page.locator('.login-card .el-input__inner')
    await ins.nth(0).fill(user)
    await ins.nth(1).fill(pwd)
    await page.click('.submit')
    await page.waitForTimeout(2000)
  }
  const openSettings = async () => {
    await page.goto(BASE + '/my', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(1600)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.tabs button')].find((x) => /账号设置/.test(x.textContent))
      if (b) b.click()
    })
    await page.waitForTimeout(900)
  }
  const myEmailInStore = () =>
    page.evaluate(() => {
      try { return (JSON.parse(localStorage.getItem('userInfo') || '{}').email || '') } catch { return '' }
    })

  console.log('--- A/B. 未绑定账号（admin）：区块渲染与分支 ---')
  await loginAs(ADMIN_USER, ADMIN_PW)
  const loggedIn = await page.evaluate(() => !!localStorage.getItem('token'))
  if (!loggedIn) {
    console.log('❌ 登录失败，后续用例无法执行（请确认后端在跑、admin 口令正确）')
    console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
    await browser.close()
    process.exit(1)
  }
  await openSettings()

  ok(await emailBlock(page).count() === 1, 'A1 「📧 绑定邮箱」区块已渲染')
  const blockText = await page.evaluate(() => {
    const title = [...document.querySelectorAll('.pc-title')].find((h) => /绑定邮箱/.test(h.textContent))
    return title.closest('.el-form').textContent.replace(/\s+/g, '')
  })
  ok(/当前邮箱/.test(blockText), `A2 有「当前邮箱」一项 → "${blockText.slice(0, 60)}…"`)
  ok(/新邮箱验证码/.test(blockText), 'A3 有「新邮箱验证码」一项')
  ok(/不支持解绑/.test(blockText), 'A4 说明里写明「邮箱只支持更换，不支持解绑」')

  const adminMail = await myEmailInStore()
  const phs = await emailInputs(page)
  if (!adminMail) {
    ok(/尚未绑定/.test(blockText), `B1 未绑定账号显示「尚未绑定」提示 → "${(blockText.match(/尚未绑定[^。]*。/) || [''])[0]}"`)
    ok(/绑定邮箱/.test(blockText), 'B2 提交按钮文案为「绑定邮箱」')
    ok(!/原邮箱验证码/.test(blockText), 'B3 未绑定时不出现「原邮箱验证码」（没有原邮箱可验）')
    ok(phs.length === 2 && phs[0].includes('要绑定'), `B4 只有「新邮箱 + 新邮箱验证码」两个输入 → [${phs}]`)
  } else {
    ok(/\*\*\*/.test(blockText), `B1 已绑定账号展示**脱敏**邮箱（不露全量）→ "${blockText.slice(0, 40)}…"`)
    ok(/原邮箱验证码/.test(blockText), 'B2 已绑定时出现「原邮箱验证码」')
    ok(/确认更换/.test(blockText), 'B3 提交按钮文案为「确认更换」')
    ok(phs.length === 3, `B4 已绑定时为「原邮箱码 / 新邮箱 / 新邮箱码」三个输入 → [${phs}]`)
    ok(/两个验证码都通过才生效/.test(blockText), 'B5 说明里讲清「两个验证码都通过才生效」')
  }
  const adminMailBefore = adminMail

  console.log('--- C. 前端拦截（未绑定账号路径）---')
  await clearMsgs(page)
  await clickEmailBtn(page, '发送验证码') // 新邮箱那一行的按钮
  ok(/请先填写新邮箱/.test(await lastMsg(page)), `C1 未填新邮箱就点发码 → 被拦（"${await lastMsg(page)}"）`)

  await clearMsgs(page)
  await fillEmailInput(page, adminMailBefore ? 1 : 0, 'not-an-email')
  await clickEmailBtn(page, '发送验证码')
  ok(/邮箱格式不正确/.test(await lastMsg(page)), `C2 邮箱格式错 → 被拦（"${await lastMsg(page)}"）`)

  await clearMsgs(page)
  await fillEmailInput(page, adminMailBefore ? 1 : 0, '') // 先清掉 C2 留下的非法值，否则命中的是「格式不正确」
  await clickEmailBtn(page, adminMailBefore ? '确认更换' : '绑定邮箱')
  const noMail = await lastMsg(page)
  ok(/新邮箱/.test(noMail), `C3 缺新邮箱就提交 → 被拦（"${noMail}"）`)

  await clearMsgs(page)
  const randomMail = `mypw_${Date.now().toString(36)}@qq.com`
  await fillEmailInput(page, adminMailBefore ? 1 : 0, randomMail)
  await clickEmailBtn(page, adminMailBefore ? '确认更换' : '绑定邮箱')
  const noCode = await lastMsg(page)
  ok(/验证码/.test(noCode), `C4 有合法新邮箱但缺 6 位验证码 → 被拦（"${noCode}"）`)

  if (adminMailBefore) {
    await clearMsgs(page)
    await fillEmailInput(page, 0, TEST_CODE)          // 原邮箱码（位数合法）
    await fillEmailInput(page, 2, '000000')           // 新邮箱码（未经发送）
    await clickEmailBtn(page, '确认更换')
    const r = await lastMsg(page)
    ok(/验证码|过期/.test(r), `C5 新邮箱码未经发送 → 后端拒（"${r}"）`)
  } else {
    await clearMsgs(page)
    await fillEmailInput(page, 1, '000000')
    await clickEmailBtn(page, '绑定邮箱')
    const r = await lastMsg(page)
    ok(/验证码|过期/.test(r), `C5 新邮箱码未经发送 → 后端拒（"${r}"）`)
  }
  // 🚨 tripwire：整组 C 都不该改变当前邮箱
  await page.waitForTimeout(500)
  const adminMailAfter = await myEmailInStore()
  ok(adminMailAfter === adminMailBefore,
    `C6 tripwire：当前邮箱未被改动（"${adminMailBefore}" → "${adminMailAfter}"）`)

  console.log('--- D. 已绑定账号分支 ---')
  // 用测试通道造一个「已绑邮箱」的账号：先发码（register 场景）再注册
  const U = 'mymail_' + Date.now().toString(36).slice(-6)
  const M = `mymail_${Date.now().toString(36).slice(-6)}@qq.com`
  const PW = 'pass123456'
  const sendR = await api('POST', '/auth/email-code', { email: M, scene: 'register' })
  const regR = await api('POST', '/auth/register', { username: U, password: PW, email: M, emailCode: TEST_CODE })
  if (regR.code !== 200) {
    skipped(`测试通道不可用（注册返回 ${regR.code} "${regR.message}"）；请用 MAIL_TEST_CODE=${TEST_CODE} 启动后端后重跑`)
  } else {
    ok(!!regR.data?.token, `D1 测试账号已就绪（${U} + ${M}，发码 ${sendR.code}）`)
    await loginAs(U, PW)
    await openSettings()
    const dBlock = await page.evaluate(() => {
      const title = [...document.querySelectorAll('.pc-title')].find((h) => /绑定邮箱/.test(h.textContent))
      return title ? title.closest('.el-form').textContent.replace(/\s+/g, '') : ''
    })
    const dPhs = await emailInputs(page)
    const expectMasked = M.slice(0, 2) + '***' + M.slice(M.indexOf('@'))
    ok(dBlock.includes(expectMasked), `D2 展示脱敏邮箱 ${expectMasked}（不露全量）`)
    ok(/原邮箱验证码/.test(dBlock) && /确认更换/.test(dBlock), 'D3 出现「原邮箱验证码」且按钮为「确认更换」')
    ok(dPhs.length === 3, `D4 三个输入（原邮箱码/新邮箱/新邮箱码）→ [${dPhs}]`)
    ok(/原邮箱已失效请联系管理员/.test(dBlock), 'D5 原邮箱失效时的兜底指引已在页面上')

    await clearMsgs(page)
    await fillEmailInput(page, 1, `d_${Date.now().toString(36).slice(-5)}@qq.com`)
    await fillEmailInput(page, 2, '123456')
    await clickEmailBtn(page, '确认更换')
    const dMsg = await lastMsg(page)
    ok(/原邮箱验证/.test(dMsg), `D6 缺原邮箱验证码 → 前端就拦住（"${dMsg}"）`)

    // 清掉这个测试账号的登录态，别影响后续（localStorage 只在本浏览器上下文里）
    await page.evaluate(() => localStorage.clear())
    ok(true, 'D7 已清理浏览器登录态（测试账号保留在库中，可按 mymail_ 前缀清理）')
  }

  console.log('--- E. 控制台 ---')
  const hard = errors.filter((e) => !/Failed to load resource/.test(e))
  ok(hard.length === 0, `E1 无 pageerror / 未注册组件告警（${hard.length} 条硬错误）`)
  if (errors.length) console.log(`（另有 ${errors.length} 条已记录，含预期的接口失败）`)
  hard.forEach((e) => console.log('  ' + e))

  await page.goto(BASE + '/my', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(800)
  await browser.close()
  console.log(`\n=== 结果：${pass}/${pass + fail} 通过${skip ? `（${skip} 组跳过）` : ''} ===`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error(e.message); process.exit(1) })

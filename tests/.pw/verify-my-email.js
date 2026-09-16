/**
 * 个人中心「📧 绑定邮箱 / 邮箱换绑」区块回归（9-15 新增功能，9-16 按反馈微调）
 *
 *   非破坏性：**只验证「拦得住」，不做任何真实绑定/更换**（admin 那种账号一旦被改邮箱，
 *   后续其它测试脚本的登录假设就全废了）。唯一会真发出去的是几封 mock 验证码（只打后端日志）。
 *
 *   A 区块渲染（标题随绑定状态变 / 当前邮箱 / 新邮箱 / 验证码 / 提交按钮）+
 *       「当前账号」不带 @ 前缀 + **设置页全部 label 单行不换行**（9-16 新增的回归点）
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
/**
 * 邮箱区块是设置页里唯一「标题含『邮箱』」的那块表单。
 * ⚠️ 标题 9-16 起随绑定状态变：已绑定 = 「📧 邮箱换绑」，未绑定 = 「📧 绑定邮箱」
 * —— 下面所有 page.evaluate 里都用 `/邮箱换绑|绑定邮箱/` 定位，别写死其中一个。
 */
const emailBlock = (page) => page.locator('.pc-title:has-text("邮箱")')
/** 邮箱区块内的输入框：已绑定时 = [原邮箱码, 新邮箱, 新邮箱码]；未绑定时 = [新邮箱, 新邮箱码] */
const emailInputs = (page) =>
  page.evaluate(() => {
    const title = [...document.querySelectorAll('.pc-title')].find((h) => /邮箱换绑|绑定邮箱/.test(h.textContent))
    if (!title) return []
    const form = title.closest('.el-form')
    if (!form) return []
    return [...form.querySelectorAll('.el-input__inner')].map((i) => i.placeholder)
  })
const clickEmailBtn = async (page, label) => {
  await page.evaluate((lb) => {
    const title = [...document.querySelectorAll('.pc-title')].find((h) => /邮箱换绑|绑定邮箱/.test(h.textContent))
    const form = title.closest('.el-form')
    const btn = [...form.querySelectorAll('button')].find((b) => b.textContent.trim().includes(lb))
    if (btn) btn.click()
  }, label)
  await page.waitForTimeout(700)
}
const fillEmailInput = async (page, idx, val) => {
  const handle = await page.evaluateHandle((i) => {
    const title = [...document.querySelectorAll('.pc-title')].find((h) => /邮箱换绑|绑定邮箱/.test(h.textContent))
    const form = title.closest('.el-form')
    return form.querySelectorAll('.el-input__inner')[i]
  }, idx)
  const el = handle.asElement()
  await el.fill(val)
  await page.waitForTimeout(150)
}

/**
 * 量出设置页所有 label 的「实际渲染行数」与「溢出量」。
 *
 * ⚠️ 必须用 Range#getClientRects 数行，**不能**用 offsetHeight —— El-Plus 的 label 带固定
 *    line-height，换行时高度未必翻倍，量高度会漏判（这正是 9-16 那个「新邮箱验证码」被挤成
 *    「新邮箱验证」+「码」两行却没被发现的原因）。
 * 传给 page.evaluate 的函数体里不能引用外层变量，故写成自包含的常量。
 */
const LABEL_PROBE = () => {
  const out = []
  document.querySelectorAll('.settings .el-form-item__label').forEach((l) => {
    const t = l.textContent.replace(/\s+/g, '')
    if (!t) return
    const r = document.createRange()
    r.selectNodeContents(l)
    const tops = new Set([...r.getClientRects()].map((x) => Math.round(x.top)))
    out.push({ t, lines: tops.size, over: Math.round(l.scrollWidth - l.clientWidth) })
  })
  return out
}
/** 把探针结果格式化成「异常 label 明细」，正常时为空串 */
const badLabels = (list) => list.filter((x) => x.lines > 1 || x.over > 1)
const fmtBad = (bad) => (bad.length ? '：' + bad.map((w) => `${w.t}(${w.lines} 行/溢 ${w.over}px)`).join('、') : '')

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

  const adminMail = await myEmailInStore()
  ok(await emailBlock(page).count() === 1, 'A1 邮箱区块已渲染（标题含「邮箱」的表单恰好一块）')

  // 9-16：标题随绑定状态变 —— 已绑定叫「邮箱换绑」，没绑过才叫「绑定邮箱」
  const titleText = await page.evaluate(() => {
    const h = [...document.querySelectorAll('.pc-title')].find((x) => /邮箱/.test(x.textContent))
    return h ? h.textContent.replace(/\s+/g, '') : ''
  })
  ok(adminMail ? /邮箱换绑/.test(titleText) : /绑定邮箱/.test(titleText),
    `A1b 标题与绑定状态一致 → "${titleText}"（当前${adminMail ? '已' : '未'}绑定）`)

  // 9-16：账号行去掉 @ 前缀（原先显示「@sao_bi」，容易被读成账号id 本身就含 @）
  const accText = await page.evaluate(() => {
    const it = [...document.querySelectorAll('.el-form-item')]
      .find((el) => /当前账号/.test(el.querySelector('.el-form-item__label')?.textContent || ''))
    return it ? (it.querySelector('.acc-now')?.textContent || '').trim() : ''
  })
  ok(accText.length > 0 && !accText.startsWith('@'), `A1c 「当前账号」不带 @ 前缀 → "${accText}"`)

  const blockText = await page.evaluate(() => {
    const title = [...document.querySelectorAll('.pc-title')].find((h) => /邮箱换绑|绑定邮箱/.test(h.textContent))
    return title.closest('.el-form').textContent.replace(/\s+/g, '')
  })
  ok(/当前邮箱/.test(blockText), `A2 有「当前邮箱」一项 → "${blockText.slice(0, 60)}…"`)
  ok(/新邮箱验证码/.test(blockText), 'A3 有「新邮箱验证码」一项')
  ok(/不支持解绑/.test(blockText), 'A4 说明里写明「邮箱只支持更换，不支持解绑」')

  // 9-16：设置页所有 label 必须单行且不溢出（原先 label-width=84px 装不下 7 个汉字的
  // 「新邮箱验证码」，被挤成两行，与右对齐的其它 label 参差不齐）。此处是**未绑定**状态。
  const labelBox = await page.evaluate(LABEL_PROBE)
  const badA = badLabels(labelBox)
  ok(labelBox.length > 0 && badA.length === 0,
    `A5 设置页 ${labelBox.length} 个 label 全部单行且不溢出（异常 ${badA.length} 个${fmtBad(badA)}）`)

  const phs = await emailInputs(page)
  if (!adminMail) {
    ok(/尚未绑定/.test(blockText), `B1 未绑定账号显示「尚未绑定」提示 → "${(blockText.match(/尚未绑定[^。]*。/) || [''])[0]}"`)
    ok(/绑定邮箱/.test(blockText), 'B2 提交按钮文案为「绑定邮箱」')
    ok(!/原邮箱验证码/.test(blockText), 'B3 未绑定时不出现「原邮箱验证码」（没有原邮箱可验）')
    ok(phs.length === 2, `B4 只有「新邮箱 + 新邮箱验证码」两个输入 → [${phs}]`)
    ok(phs[0] === '' && phs[1] === '6 位数字',
      `B5 新邮箱框无提示词、验证码框仍保留「6 位数字」（9-16 按反馈去掉）→ [${phs}]`)
  } else {
    ok(/\*\*\*/.test(blockText), `B1 已绑定账号展示**脱敏**邮箱（不露全量）→ "${blockText.slice(0, 40)}…"`)
    ok(/原邮箱验证码/.test(blockText), 'B2 已绑定时出现「原邮箱验证码」')
    ok(/确认更换/.test(blockText), 'B3 提交按钮文案为「确认更换」')
    ok(phs.length === 3, `B4 已绑定时为「原邮箱码 / 新邮箱 / 新邮箱码」三个输入 → [${phs}]`)
    ok(phs[1] === '', `B5 新邮箱框无提示词（9-16 按反馈去掉）→ [${phs}]`)
    ok(/两个验证码都通过才生效/.test(blockText), 'B6 说明里讲清「两个验证码都通过才生效」')
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

    // 9-16：**已绑定**状态才是新文案的用武之地 —— 标题叫「邮箱换绑」，且多出一个 6 字的
    // 「原邮箱验证码」label（未绑定状态下根本不渲染，A5 覆盖不到），一并量一次。
    const dTitle = await page.evaluate(() => {
      const h = [...document.querySelectorAll('.pc-title')].find((x) => /邮箱/.test(x.textContent))
      return h ? h.textContent.replace(/\s+/g, '') : ''
    })
    ok(/邮箱换绑/.test(dTitle), `D1b 已绑定账号标题为「📧 邮箱换绑」（未绑定才叫「绑定邮箱」）→ "${dTitle}"`)
    const dLabels = await page.evaluate(LABEL_PROBE)
    const badD = badLabels(dLabels)
    ok(badD.length === 0,
      `D1c 已绑定状态 ${dLabels.length} 个 label 仍单行且不溢出（含「原邮箱验证码」）（异常 ${badD.length} 个${fmtBad(badD)}）`)

    const dBlock = await page.evaluate(() => {
      const title = [...document.querySelectorAll('.pc-title')].find((h) => /邮箱换绑|绑定邮箱/.test(h.textContent))
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

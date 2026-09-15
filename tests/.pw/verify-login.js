/**
 * 登录页回归（9-15 三态改版后）：
 *   A 按钮对齐（「游客浏览」曾被 Element 的 `.el-button + .el-button{margin-left:12px}` 顶右 12px）
 *   B 协议勾选行**只在「注册」Tab 出现**（登录不涉及协议签署）
 *   C 注册校验顺序：账号id → 邮箱 → 验证码 → 协议（未勾选被拦）
 *   D 点协议链接不误勾选
 *   E 账号字符过滤**只在注册态生效**（中文 / 特殊符号实时剔除；@ 和 . 已收回）
 *   E2 提示文案与放行范围一致（能输什么就必须提示什么 —— 2026-09-15 用户实测发现的矛盾）
 *   H 登录态**不过滤**字符（邮箱登录要能输 @ . - +）
 *   I 忘记密码视图（独立视图、无 Tab、可返回；账号栏填了邮箱会带过去）
 *   J 注册表单字段顺序（账号id → 密码 → 邮箱 → 验证码）+ 发送验证码按钮
 *   K 窄屏无横向溢出
 *   L 控制台无硬错误
 * 需要：dev server 或 preview 产物在 5173（WEB_BASE 可覆盖）
 * ⚠️ C 组会真的发一次注册请求，用以证明协议校验已放行；用的是**已存在账号** yumu，
 *    因此后端在跑（返回 409）或没跑（请求失败）都不会新建数据、也不会跳转。
 * ⚠️ J 组会真的发一次「注册验证码」，用的是随机未注册邮箱（后端 mock 模式只打日志）。
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'

let pass = 0
let fail = 0
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('✅', msg) } else { fail++; console.log('❌', msg) }
}
const clearMsgs = (page) => page.evaluate(() => document.querySelectorAll('.el-message').forEach((e) => e.remove()))
const lastMsg = (page) => page.evaluate(() => {
  const all = [...document.querySelectorAll('.el-message')]
  const last = all[all.length - 1]
  return last ? last.textContent.replace(/\s+/g, ' ').trim() : ''
})
/** 卡片内的输入框；注册态顺序 = 账号id(0) / 密码(1) / 邮箱(2) / 验证码(3) */
const inputs = (page) => page.locator('.login-card .el-input__inner')
const userField = (page) => inputs(page).nth(0)
const passField = (page) => inputs(page).nth(1)
const emailField = (page) => inputs(page).nth(2)
const codeField = (page) => inputs(page).nth(3)
const toRegister = async (page) => {
  await page.click('.tabs button:nth-child(2)')
  await page.waitForTimeout(400)
}
const toLogin = async (page) => {
  await page.click('.tabs button:nth-child(1)')
  await page.waitForTimeout(400)
}
const typeAndRead = async (page, input) => {
  await userField(page).fill(input)
  await page.waitForTimeout(200)
  return userField(page).inputValue()
}
const placeholders = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.login-card .el-input__inner')].map((i) => i.placeholder))

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const errors = []
  const page = await browser.newPage({ viewport: { width: 1080, height: 620 } })
  page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text())
    if (m.type() === 'warning' && /Failed to resolve/.test(m.text())) errors.push('RESOLVE: ' + m.text())
  })

  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1800)

  console.log('--- A. 按钮对齐（"歪了"回归）---')
  const geo = await page.evaluate(() => {
    const box = (s) => {
      const el = document.querySelector(s)
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { l: +b.left.toFixed(1), r: +b.right.toFixed(1), w: +b.width.toFixed(1) }
    }
    const g = document.querySelector('.guest')
    const card = document.querySelector('.login-card')
    const cs = getComputedStyle(card)
    return {
      submit: box('.submit'),
      guest: box('.guest'),
      card: box('.login-card'),
      guestML: g ? getComputedStyle(g).marginLeft : null,
      cardPadR: parseFloat(cs.paddingRight),
      docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }
  })
  ok(!!geo.submit && !!geo.guest, 'A1 「登录」「游客浏览」两按钮均存在')
  ok(Math.abs(geo.guest.l - geo.submit.l) <= 0.5, `A2 左缘对齐（游客 ${geo.guest.l} / 登录 ${geo.submit.l}）`)
  ok(Math.abs(geo.guest.r - geo.submit.r) <= 0.5, `A3 右缘对齐（游客 ${geo.guest.r} / 登录 ${geo.submit.r}）`)
  ok(geo.guest.w === geo.submit.w, `A4 两按钮等宽（${geo.guest.w}px）`)
  ok(geo.guestML === '0px', `A5 游客浏览 margin-left 已归零（实测 ${geo.guestML}）`)
  const cardInnerR = geo.card.r - geo.cardPadR
  ok(geo.guest.r <= cardInnerR + 0.5, `A6 未越出卡片内边距（${geo.guest.r} ≤ ${cardInnerR.toFixed(1)}）`)
  ok(geo.docOver <= 0, 'A7 无横向滚动溢出')

  console.log('--- B. 协议勾选行只在「注册」Tab 出现 ---')
  const loginTabHasAgree = await page.evaluate(() => !!document.querySelector('.agree'))
  ok(!loginTabHasAgree, 'B1 登录 Tab 下不渲染勾选行')

  await toRegister(page)
  const activeTab = await page.evaluate(() => document.querySelector('.tabs button.active')?.textContent.trim())
  ok(activeTab === '注册', `B2 已切到「注册」Tab（当前 ${activeTab}）`)

  const cb = await page.evaluate(() => {
    const el = document.querySelector('.agree')
    if (!el) return { exists: false }
    return {
      exists: true,
      text: el.textContent.replace(/\s+/g, ''),
      checked: el.classList.contains('is-checked'),
      agreement: !!el.querySelector('a[href="/agreement"]'),
      privacy: !!el.querySelector('a[href="/privacy"]'),
      boxTop: +el.getBoundingClientRect().top.toFixed(1),
      guestBottom: +document.querySelector('.guest').getBoundingClientRect().bottom.toFixed(1)
    }
  })
  ok(cb.exists, 'B3 注册 Tab 下勾选行已渲染')
  ok(cb.exists && cb.checked === false, 'B4 默认未勾选')
  ok(cb.exists && /我已阅读并同意/.test(cb.text), 'B5 文案含「我已阅读并同意」')
  ok(cb.exists && /用户协议/.test(cb.text) && /隐私政策/.test(cb.text), 'B6 文案含两份协议名')
  ok(cb.exists && cb.agreement && cb.privacy, 'B7 《用户协议》《隐私政策》链接指向 /agreement、/privacy')
  ok(cb.exists && cb.boxTop >= cb.guestBottom - 1, `B8 位于「游客浏览」下方（勾选 top ${cb.boxTop} ≥ 按钮 bottom ${cb.guestBottom}）`)
  const innerBg = await page.evaluate(() => {
    const el = document.querySelector('.agree .el-checkbox__inner')
    return el ? getComputedStyle(el).backgroundColor : null
  })
  ok(innerBg && innerBg !== 'rgb(255, 255, 255)', `B9 未勾选框已适配暗色主题，非纯白填充（${innerBg}）`)

  await toLogin(page)
  ok(!(await page.evaluate(() => !!document.querySelector('.agree'))), 'B10 切回登录 Tab 勾选行再次消失')
  await toRegister(page)

  console.log('--- C. 注册校验链（顺序：账号id → 邮箱 → 验证码 → 协议）---')
  // 🚨 用**已存在的账号**（种子里的 yumu）而不是随机名：C6 会真的发一次注册请求以证明
  //    协议校验已放行 —— 若拿随机名且本地后端恰好在跑，就会在库里落一个测试账号并跳转首页。
  //    用已存在账号时后端返回 409「账号id 已被使用」：既证明请求发出去了，又零写入。
  //    2026-09-15 实测踩过：上一轮 java 进程没杀干净 → 真建了 1 个 probe_ 账号（已清理）。
  const probeUser = 'yumu'

  // C1 缺邮箱被拦（注册现在必须有邮箱）
  await userField(page).fill(probeUser)
  await passField(page).fill('probe123456')
  await page.click('.submit')
  await page.waitForTimeout(700)
  ok(/邮箱/.test(await lastMsg(page)), `C1 只填账号+密码 → 先被「邮箱」拦住（"${await lastMsg(page)}"）`)

  // C2 邮箱格式错被拦
  await clearMsgs(page)
  await emailField(page).fill('not-an-email')
  await page.click('.submit')
  await page.waitForTimeout(700)
  ok(/邮箱/.test(await lastMsg(page)), `C2 邮箱格式错被拦（"${await lastMsg(page)}"）`)

  // C3 缺验证码被拦
  await clearMsgs(page)
  await emailField(page).fill('probe@qq.com')
  await page.click('.submit')
  await page.waitForTimeout(700)
  ok(/验证码/.test(await lastMsg(page)), `C3 缺 6 位验证码被拦（"${await lastMsg(page)}"）`)

  // C4 字段齐全但未勾选协议 → 协议拦截
  await clearMsgs(page)
  await codeField(page).fill('123456')
  await page.click('.submit')
  await page.waitForTimeout(700)
  const m1 = await lastMsg(page)
  ok(/协议/.test(m1), `C4 字段齐全但未勾选协议 → 被协议拦截（"${m1}"）`)

  // C5 勾选后方可提交（零写入：账号已被占用 → 409）
  await clearMsgs(page)
  await page.click('.agree .el-checkbox__input')
  await page.waitForTimeout(300)
  ok(await page.evaluate(() => document.querySelector('.agree').classList.contains('is-checked')), 'C5 点击方块可勾选')
  await page.click('.submit')
  await page.waitForTimeout(1800)
  const m2 = await lastMsg(page)
  ok(!/协议/.test(m2), `C6 勾选后协议校验放行、不再拦协议（"${m2}"）`)
  // tripwire：一旦真注册成功，说明本次测试污染了数据库，必须立刻暴露而不是静默通过
  ok(!/注册成功/.test(m2), `C7 未真的建号（后端已存在该账号，应返回冲突而非注册成功）→ "${m2}"`)

  console.log('--- D. 协议链接（点链接不应误勾选）---')
  await clearMsgs(page)
  await page.click('.agree .el-checkbox__input').catch(() => {})
  await page.waitForTimeout(200)
  const toggle = await page.evaluate(() => {
    const link = document.querySelector('.agree-link')
    const box = document.querySelector('.agree')
    const before = box.classList.contains('is-checked')
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return { before, after: box.classList.contains('is-checked') }
  })
  ok(toggle.before === toggle.after, `D1 点《用户协议》链接不误改勾选态（${toggle.before} → ${toggle.after}）`)
  await page.waitForTimeout(900)
  ok(page.url().endsWith('/agreement'), `D2 链接跳转到 /agreement（${page.url()}）`)

  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1200)
  await toRegister(page)
  ok(await page.evaluate(() => !!document.querySelector('a[href="/privacy"]')), 'D3 《隐私政策》链接存在')

  console.log('--- E. 注册态账号字符过滤（只留字母 / 数字 / 下划线）---')
  const afterCn = await typeAndRead(page, '测试abc')
  ok(afterCn === 'abc', `E1 中文被实时剔除（"测试abc" → "${afterCn}"）`)

  const afterSym = await typeAndRead(page, 'ab c#$d')
  ok(afterSym === 'abcd', `E2 空格与特殊符号被剔除（"ab c#$d" → "${afterSym}"）`)

  // 📌 9-15 收口：@ 和 . 的口子收回了（邮箱登录改由独立邮箱字段承担）
  const afterAt = await typeAndRead(page, 'abc@def.com')
  ok(afterAt === 'abcdefcom', `E3 @ 与 . 已被剔除（口子收回，改由邮箱字段承担）→ "${afterAt}"`)

  const afterUnder = await typeAndRead(page, 'abc_def_123')
  ok(afterUnder === 'abc_def_123', `E4 下划线放行（与「修改账号」规则一致）→ "${afterUnder}"`)

  console.log('--- E2. 提示文案必须与放行范围一致（2026-09-15 回归点）---')
  // 回归来源：能输 @ . _ 却只提示「字母、数字、下划线」→ 用户一眼看出自相矛盾。
  // 9-15 收口后规则与文案都只剩「字母 / 数字 / 下划线」，本组把两者绑死：
  // 改了过滤正则而忘了改文案（或反之），这里必红。
  await clearMsgs(page)
  await page.waitForTimeout(2600) // 越过 tipUsernameOnce 的 2.5s 节流
  const afterMix = await typeAndRead(page, 'ab@c.d_中')
  ok(afterMix === 'abcd_', `E7 混合输入只留 [A-Za-z0-9_]（"ab@c.d_中" → "${afterMix}"）`)
  await page.waitForTimeout(300)
  const tip = await lastMsg(page)
  // ⚠️ 只看「规则文案」那半句（「（已忽略：@ . 中）」是被剔除字符的回显，它当然含 @ .）。
  const rulePart = (s) => String(s).split('（已忽略')[0]
  const coversAll = (s) => {
    const r = rulePart(s)
    return !r.includes('@') && !r.includes('.') && /字母/.test(r) && /数字/.test(r) && /下划线/.test(r)
  }
  ok(coversAll(tip), `E8 规则文案只列实际放行字符（字母/数字/下划线，不再提 @ .）→ "${tip}"`)
  ok(/中/.test(tip), `E9 提示回显被剔除的字符，用户知道哪些字被吃了 → "${tip}"`)

  const regHint = await page.evaluate(
    () => document.querySelector('.hint')?.textContent.replace(/\s+/g, '') || ''
  )
  ok(coversAll(regHint) && /3-20/.test(regHint), `E10 注册态底部说明与实际放行范围一致 → "${regHint}"`)
  ok(/验证码/.test(regHint) && /60/.test(regHint), `E11 注册态底部说明讲了验证码有效期与重发间隔 → "${regHint}"`)

  // ⚠️ 必须先填密码：D 组跳转过页面，表单是空的，否则会先命中「请填写账号id 和密码」
  await clearMsgs(page)
  await userField(page).fill('ab')
  await passField(page).fill('probe123456')
  await page.click('.submit')
  await page.waitForTimeout(700)
  const mShort = await lastMsg(page)
  ok(/3-20/.test(mShort), `E6 账号过短（2 位）提交被拦（"${mShort}"）`)

  console.log('--- H. 登录态不过滤字符（要能输邮箱）---')
  await toLogin(page)
  const h1 = await typeAndRead(page, 'abc@def.com')
  ok(h1 === 'abc@def.com', `H1 登录态保留 @ 与 .（否则邮箱登录没法用）→ "${h1}"`)
  const h2 = await typeAndRead(page, 'Test.User+tag@qq.com')
  ok(h2 === 'Test.User+tag@qq.com', `H2 登录态保留大写与 + 号 → "${h2}"`)
  const h3 = await typeAndRead(page, '中文测试')
  ok(h3 === '中文测试', `H3 登录态不剔除中文（老账号/异常输入的报错交给后端）→ "${h3}"`)
  const loginHint = await page.evaluate(
    () => document.querySelector('.hint')?.textContent.replace(/\s+/g, '') || ''
  )
  ok(/账号id/.test(loginHint) && /邮箱/.test(loginHint), `H4 登录态说明明确「账号id 或 邮箱」（防歧义）→ "${loginHint}"`)
  await clearMsgs(page)
  await userField(page).fill('')
  await passField(page).fill('')
  await page.click('.submit')
  await page.waitForTimeout(700)
  ok(/邮箱/.test(await lastMsg(page)), `H5 登录空提交 → 提示里点名「邮箱」（"${await lastMsg(page)}"）`)

  console.log('--- I. 忘记密码视图 ---')
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1200)
  ok(await page.evaluate(() => !!document.querySelector('.forgot-row a')), 'I1 登录态有「忘记密码？」入口')
  // 账号栏里填了邮箱 → 应当带进忘记密码视图，省一次输入
  await userField(page).fill('carry@qq.com')
  await page.click('.forgot-row a')
  await page.waitForTimeout(500)
  ok(await page.evaluate(() => !document.querySelector('.tabs')), 'I2 忘记密码是独立视图，不显示登录/注册 Tab')
  const subTitle = await page.evaluate(() => document.querySelector('.sub-title')?.textContent.trim())
  ok(subTitle === '重置密码', `I3 视图标题为「重置密码」（当前 ${subTitle}）`)
  const fpPh = await placeholders(page)
  ok(fpPh.length === 4, `I4 忘记密码有 4 个输入（邮箱/验证码/新密码/确认）→ ${fpPh.length} 个`)
  ok(fpPh[0] === '绑定邮箱' && fpPh[1] === '邮箱验证码（6 位）', `I5 前两个字段为邮箱与验证码 → [${fpPh.slice(0, 2)}]`)
  const carried = await inputs(page).nth(0).inputValue()
  ok(carried === 'carry@qq.com', `I6 账号栏里的邮箱已带过来（实测 "${carried}"）`)
  ok(await page.evaluate(() => !!document.querySelector('.code-btn')), 'I7 忘记密码有「发送验证码」按钮')
  ok(await page.evaluate(() => !!document.querySelector('.guest')), 'I8 忘记密码有返回入口')
  await clearMsgs(page)
  await page.click('.submit')
  await page.waitForTimeout(700)
  ok(/填写完整/.test(await lastMsg(page)), `I9 空表单提交被拦（"${await lastMsg(page)}"）`)
  await page.click('.guest')
  await page.waitForTimeout(600)
  ok(await page.evaluate(() => !!document.querySelector('.tabs')), 'I10 点返回回到登录/注册视图')

  console.log('--- J. 注册表单字段顺序 + 发送验证码 ---')
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1200)
  await toRegister(page)
  const ph = await placeholders(page)
  ok(ph[0]?.startsWith('账号id'), `J1 第 1 个字段 = 账号id → "${ph[0]}"`)
  ok(ph[1] === '密码', `J2 第 2 个字段 = 密码 → "${ph[1]}"`)
  ok(ph[2] === '邮箱', `J3 第 3 个字段 = 邮箱 → "${ph[2]}"`)
  ok(ph[3] === '邮箱验证码（6 位）', `J4 第 4 个字段 = 验证码 → "${ph[3]}"`)
  const btn0 = await page.evaluate(() => document.querySelector('.code-row .code-btn')?.textContent.trim())
  ok(btn0 === '发送验证码', `J5 发码按钮初始文案为「发送验证码」→ "${btn0}"`)
  ok(await page.evaluate(() => document.querySelector('.forgot-row') === null), 'J6 注册态不显示「忘记密码？」')
  // 真发一次（mock 模式只打日志）。用随机未注册邮箱避免 409。
  const jMail = `pw_${Date.now().toString(36)}@qq.com`
  await emailField(page).fill(jMail)
  await page.click('.code-row .code-btn')
  await page.waitForTimeout(1500)
  const jMsg = await lastMsg(page)
  const btn1 = await page.evaluate(() => document.querySelector('.code-row .code-btn')?.textContent.trim())
  if (/验证码已发送/.test(jMsg)) {
    ok(/^\d+s$/.test(btn1), `J7 发码成功 → 按钮进入 60s 冷却倒计时（实测 "${btn1}"）`)
  } else {
    // 本地被 IP 发码上限挡住时会走这里：属环境噪声，不作为功能缺陷
    ok(/过于频繁|稍后再试|已注册|尚未配置/.test(jMsg), `J7 未走到冷却（环境受限，非缺陷）："${jMsg}"`)
  }

  console.log('--- K. 窄屏 ---')
  await page.setViewportSize({ width: 360, height: 720 })
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1200)
  const mob = await page.evaluate(() => {
    const b = (s) => {
      const el = document.querySelector(s)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { l: +r.left.toFixed(1), r: +r.right.toFixed(1) }
    }
    return {
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      submit: b('.submit'), guest: b('.guest')
    }
  })
  ok(mob.over <= 0, `K1 360px 无横向溢出（溢出 ${mob.over}px）`)
  ok(mob.submit && mob.guest && Math.abs(mob.guest.l - mob.submit.l) <= 0.5, 'K2 窄屏下两按钮仍左缘对齐')

  await toRegister(page)
  const mobAgree = await page.evaluate(() => {
    const el = document.querySelector('.agree')
    if (!el) return null
    return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  })
  ok(mobAgree && mobAgree.over <= 0, `K3 窄屏注册 Tab 下勾选行渲染且不溢出（溢出 ${mobAgree ? mobAgree.over : 'n/a'}px）`)
  const mobCode = await page.evaluate(() => {
    const row = document.querySelector('.code-row')
    if (!row) return null
    const r = row.getBoundingClientRect()
    return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth, right: +r.right.toFixed(1) }
  })
  ok(mobCode && mobCode.over <= 0, `K4 窄屏下「邮箱 + 发码按钮」复合行不溢出（溢出 ${mobCode ? mobCode.over : 'n/a'}px）`)

  await page.setViewportSize({ width: 1080, height: 620 })
  await page.waitForTimeout(400)
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'login-desktop.png' })
  await toRegister(page)
  await page.screenshot({ path: 'login-register-tab.png' })
  await toLogin(page)
  await page.click('.forgot-row a').catch(() => {})
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'login-forgot.png' })

  console.log('--- L. 控制台 ---')
  // C6 与 J7 会真的发起请求（注册 / 发码），后端未启动或被限频时必然产生
  // "Failed to load resource" 类 console error —— 属预期噪声，不计入硬错误。
  const hard = errors.filter((e) => !/Failed to load resource/.test(e))
  ok(hard.length === 0, `L1 无 pageerror / 未注册组件告警（${hard.length} 条硬错误）`)
  if (errors.length) console.log(`（另有 ${errors.length} 条已记录，含预期的接口失败）`)
  hard.forEach((e) => console.log('  ' + e))

  await browser.close()
  console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error(e.message); process.exit(1) })

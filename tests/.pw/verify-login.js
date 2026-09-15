/**
 * 登录页回归：
 *   A 按钮对齐（「游客浏览」曾被 Element 的 `.el-button + .el-button{margin-left:12px}` 顶右 12px）
 *   B 协议勾选行**只在「注册」Tab 出现**（2026-09-15 新行为：登录不涉及协议签署）
 *   C 注册未勾选协议被拦截
 *   D 点协议链接不误勾选
 *   E 账号字符过滤（中文 / 特殊符号实时剔除；@ 和 . 放行；非法账号提交被拦）
 *   E2 提示文案与放行范围一致（能输什么就必须提示什么 —— 2026-09-15 用户实测发现的矛盾）
 *   F 窄屏无横向溢出
 *   G 控制台无硬错误
 * 需要：dev server 或 preview 产物在 5173（WEB_BASE 可覆盖）
 * ⚠️ C3 会真的发一次注册请求，用以证明协议校验已放行；用的是**已存在账号** yumu，
 *    因此后端在跑（返回 409）或没跑（请求失败）都不会新建数据、也不会跳转。
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
const userField = (page) => page.locator('.el-input__inner').nth(0)
const passField = (page) => page.locator('.el-input__inner').nth(1)
const toRegister = async (page) => {
  await page.click('.tabs button:nth-child(2)')
  await page.waitForTimeout(400)
}
const toLogin = async (page) => {
  await page.click('.tabs button:nth-child(1)')
  await page.waitForTimeout(400)
}

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

  console.log('--- C. 注册拦截（未勾选不放行）---')
  // 必须先填账号密码：否则会先命中「请输入用户名和密码」，测不到后续分支
  // 🚨 用**已存在的账号**（种子里的 yumu）而不是随机 probe_xxx：
  //    C3 会真的发一次注册请求以证明协议校验已放行 —— 若拿随机名且本地后端恰好在跑，
  //    就会在库里落一个测试账号并跳转首页，连带让 D 组找不到元素。
  //    用已存在账号时后端返回 409「用户名已存在」：既证明请求发出去了，又零写入。
  //    2026-09-15 实测踩过：上一轮 java 进程没杀干净 → 真建了 1 个 probe_ 账号（已清理）。
  const probeUser = 'yumu'
  await userField(page).fill(probeUser)
  await passField(page).fill('probe123456')
  await page.click('.submit')
  await page.waitForTimeout(700)
  const m1 = await lastMsg(page)
  ok(/协议/.test(m1), `C1 已填合法账号密码但未勾选 → 被协议拦截（"${m1}"）`)

  await clearMsgs(page)
  await page.click('.agree .el-checkbox__input')
  await page.waitForTimeout(300)
  ok(await page.evaluate(() => document.querySelector('.agree').classList.contains('is-checked')), 'C2 点击方块可勾选')
  await page.click('.submit')
  await page.waitForTimeout(1500)
  const m2 = await lastMsg(page)
  ok(!/协议/.test(m2), `C3 勾选后协议校验放行、不再拦协议（"${m2}"）`)
  // tripwire：一旦真注册成功，说明本次测试污染了数据库，必须立刻暴露而不是静默通过
  ok(!/注册成功/.test(m2), `C4 未真的建号（后端已存在该账号，应返回冲突而非注册成功）→ "${m2}"`)

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

  console.log('--- E. 账号字符过滤（字母 / 数字 / 下划线，放行 @ 和 .）---')
  const typeAndRead = async (input) => {
    await userField(page).fill(input)
    await page.waitForTimeout(200)
    return userField(page).inputValue()
  }

  const afterCn = await typeAndRead('测试abc')
  ok(afterCn === 'abc', `E1 中文被实时剔除（"测试abc" → "${afterCn}"）`)

  const afterSym = await typeAndRead('ab c#$d')
  ok(afterSym === 'abcd', `E2 空格与特殊符号被剔除（"ab c#$d" → "${afterSym}"）`)

  const afterAt = await typeAndRead('abc@def.com')
  ok(afterAt === 'abc@def.com', `E3 @ 与 . 放行、原样保留（为将来邮箱登录铺垫）→ "${afterAt}"`)

  const afterUnder = await typeAndRead('abc_def_123')
  ok(afterUnder === 'abc_def_123', `E4 下划线放行（与「修改账号」规则一致）→ "${afterUnder}"`)

  console.log('--- E2. 提示文案必须与放行范围一致（2026-09-15 回归点）---')
  // 回归来源：能输 @ . _ ，但提示只写「字母、数字、下划线」→ 用户一眼看出自相矛盾。
  // 这里把「文案」和「行为」绑死：改了放行正则而忘了改文案，本组必红。
  await clearMsgs(page)
  await page.waitForTimeout(2600) // 越过 tipUsernameOnce 的 2.5s 节流
  const afterMix = await typeAndRead('ab@c.d_中')
  ok(afterMix === 'ab@c.d_', `E7 混合输入只剔中文、@ . _ 全留（"ab@c.d_中" → "${afterMix}"）`)
  await page.waitForTimeout(300)
  const tip = await lastMsg(page)
  // 注意：文案里「下划线」是中文词，不是字面量 `_`；字符类只对 @ 和 . 取字面量
  const coversAll = (s) =>
    ['@', '.'].every((c) => s.includes(c)) &&
    /字母/.test(s) && /数字/.test(s) && /下划线/.test(s)
  ok(coversAll(tip), `E8 过滤提示列出了全部放行字符（字母/数字/下划线/@/.）→ "${tip}"`)
  ok(/中/.test(tip), `E9 提示回显被剔除的字符，用户知道哪些字被吃了 → "${tip}"`)

  const hintText = await page.evaluate(
    () => document.querySelector('.hint')?.textContent.replace(/\s+/g, '') || ''
  )
  ok(coversAll(hintText) && /3-20/.test(hintText), `E10 底部说明与实际放行范围一致 → "${hintText}"`)
  ok(!/仅字母\/数字\/下划线；密码/.test(hintText), 'E11 底部说明不再出现"仅字母/数字/下划线"的旧口径')

  await clearMsgs(page)
  await userField(page).fill('abc@def')
  await passField(page).fill('probe123456')
  await page.click('.submit')
  await page.waitForTimeout(700)
  const mAt = await lastMsg(page)
  ok(/邮箱/.test(mAt) && /@/.test(mAt), `E5 填邮箱格式提交 → 提示邮箱注册未开放（"${mAt}"）`)

  await clearMsgs(page)
  await userField(page).fill('ab')
  await page.click('.submit')
  await page.waitForTimeout(700)
  const mShort = await lastMsg(page)
  ok(/3-20/.test(mShort), `E6 账号过短（2 位）提交被拦（"${mShort}"）`)

  console.log('--- F. 窄屏 ---')
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
  ok(mob.over <= 0, `F1 360px 无横向溢出（溢出 ${mob.over}px）`)
  ok(mob.submit && mob.guest && Math.abs(mob.guest.l - mob.submit.l) <= 0.5, 'F2 窄屏下两按钮仍左缘对齐')

  await toRegister(page)
  const mobAgree = await page.evaluate(() => {
    const el = document.querySelector('.agree')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth, r: +r.right.toFixed(1) }
  })
  ok(mobAgree && mobAgree.over <= 0, `F3 窄屏注册 Tab 下勾选行渲染且不溢出（溢出 ${mobAgree ? mobAgree.over : 'n/a'}px）`)

  await page.setViewportSize({ width: 1080, height: 620 })
  await page.waitForTimeout(400)
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'login-desktop.png' })
  await toRegister(page)
  await page.screenshot({ path: 'login-register-tab.png' })

  console.log('--- G. 控制台 ---')
  // C3 会真的发起一次注册请求（用于证明协议校验已放行），后端未启动时必然产生
  // "Failed to load resource" 类 console error —— 属预期噪声，不计入硬错误。
  const hard = errors.filter((e) => !/Failed to load resource/.test(e))
  ok(hard.length === 0, `G1 无 pageerror / 未注册组件告警（${hard.length} 条硬错误）`)
  if (errors.length) console.log(`（另有 ${errors.length} 条已记录，含预期的接口失败）`)
  hard.forEach((e) => console.log('  ' + e))

  await browser.close()
  console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error(e.message); process.exit(1) })

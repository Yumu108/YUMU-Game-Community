/**
 * 登录页回归：①「游客浏览」按钮与「登录」按钮对齐（曾经被 Element 的
 * `.el-button + .el-button{margin-left:12px}` 顶右 12px）② 协议勾选框存在、
 * 注册未勾选被拦截、点协议链接不会误勾选。
 * 需要：dev server 或 preview 产物在 5173（WEB_BASE 可覆盖）
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
      cardPadL: parseFloat(cs.paddingLeft),
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

  console.log('--- B. 协议勾选行 ---')
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
  ok(cb.exists, 'B1 协议勾选行已渲染')
  ok(cb.exists && cb.checked === false, 'B2 默认未勾选')
  ok(cb.exists && /我已阅读并同意/.test(cb.text), 'B3 文案含「我已阅读并同意」')
  ok(cb.exists && /用户协议/.test(cb.text) && /隐私政策/.test(cb.text), 'B4 文案含两份协议名')
  ok(cb.exists && cb.agreement && cb.privacy, 'B5 《用户协议》《隐私政策》链接指向 /agreement、/privacy')
  ok(cb.exists && cb.boxTop >= cb.guestBottom - 1, `B6 位于「游客浏览」下方（勾选 top ${cb.boxTop} ≥ 按钮 bottom ${cb.guestBottom}）`)
  const innerBg = await page.evaluate(() => {
    const el = document.querySelector('.agree .el-checkbox__inner')
    return el ? getComputedStyle(el).backgroundColor : null
  })
  ok(innerBg && innerBg !== 'rgb(255, 255, 255)', `B7 未勾选框已适配暗色主题，非纯白填充（${innerBg}）`)

  console.log('--- C. 注册拦截（未勾选不放行）---')
  await page.click('.tabs button:nth-child(2)')
  await page.waitForTimeout(400)
  const activeTab = await page.evaluate(() => document.querySelector('.tabs button.active')?.textContent.trim())
  ok(activeTab === '注册', `C1 已切到「注册」Tab（当前 ${activeTab}）`)
  ok(await page.evaluate(() => !!document.querySelector('.agree')), 'C2 注册模式下勾选行仍在')

  // 必须先填账号密码：否则会先命中「请输入用户名和密码」，测不到协议分支
  const probeUser = 'probe_' + Date.now().toString(36)
  const fields = page.locator('.el-input__inner')
  await fields.nth(0).fill(probeUser)
  await fields.nth(1).fill('probe123456')
  await page.click('.submit')
  await page.waitForTimeout(700)
  const m1 = await lastMsg(page)
  ok(/协议/.test(m1), `C3 已填账号密码但未勾选 → 被协议拦截（"${m1}"）`)

  await clearMsgs(page)
  await page.click('.agree .el-checkbox__input')
  await page.waitForTimeout(300)
  ok(await page.evaluate(() => document.querySelector('.agree').classList.contains('is-checked')), 'C4 点击方块可勾选')
  await page.click('.submit')
  await page.waitForTimeout(1500)
  const m2 = await lastMsg(page)
  ok(!/协议/.test(m2), `C5 勾选后协议校验放行、不再拦协议（"${m2}"）`)

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
  ok(await page.evaluate(() => !!document.querySelector('a[href="/privacy"]')), 'D3 《隐私政策》链接存在')

  console.log('--- E. 窄屏 ---')
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
      submit: b('.submit'), guest: b('.guest'), agree: b('.agree')
    }
  })
  ok(mob.over <= 0, `E1 360px 无横向溢出（溢出 ${mob.over}px）`)
  ok(mob.submit && mob.guest && Math.abs(mob.guest.l - mob.submit.l) <= 0.5, 'E2 窄屏下两按钮仍左缘对齐')
  ok(!!mob.agree, 'E3 窄屏下勾选行仍渲染')

  await page.setViewportSize({ width: 1080, height: 620 })
  await page.waitForTimeout(400)
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'login-desktop.png' })

  console.log('--- F. 控制台 ---')
  // C5 会真的发起一次注册请求（用于证明协议校验已放行），后端未启动时必然产生
  // "Failed to load resource" 类 console error —— 属预期噪声，不计入硬错误。
  const hard = errors.filter((e) => !/Failed to load resource/.test(e))
  ok(hard.length === 0, `F1 无 pageerror / 未注册组件告警（${hard.length} 条硬错误）`)
  if (errors.length) console.log(`（另有 ${errors.length} 条已记录，含预期的接口失败）`)
  hard.forEach((e) => console.log('  ' + e))

  await browser.close()
  console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error(e.message); process.exit(1) })

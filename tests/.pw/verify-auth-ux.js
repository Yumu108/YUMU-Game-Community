/**
 * 登录态提示 + 重置密码布局回归（2026-09-16 用户反馈）。
 *
 *   A 密码输错 → 提示「账号或密码错误」，**不能**报成「登录已过期」
 *     （根因：/auth/login 失败也返回 code=401，被 request.js 的登录态兜底吞掉了）
 *   B 首屏并发 401 → 只弹一条「登录已过期」（修复前每个请求各弹一条，堆成一片）
 *   C 主动退出登录后的"余波"401 → 静默，不弹（用户是自己点的退出，不该被指责过期）
 *   D 进站时残留的过期 token → 静默清理，不弹、不带去撞 401
 *   E 忘记密码页：「发送验证码」必须落在**验证码行**，邮箱输入独占整行
 *   F 注册页：同上（与 E、与 My.vue 邮箱换绑统一视觉）
 *   G 登录页无脚本硬错误
 *
 * 依赖：dev server 或 preview 产物在 5173（WEB_BASE 可覆盖）。
 * ⚠️ 全程用 page.route 伪造响应 —— **不需要后端、不写库**，可离线跑。
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'

let pass = 0
let fail = 0
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('✅', msg) } else { fail++; console.log('❌', msg) }
}

const json = (status, body) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
})

/** 造一个 payload 可解析、但 exp 已经过去的假 JWT（前端只读 exp，不校验签名）。 */
function jwt(offsetSec) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const header = enc({ alg: 'HS256', typ: 'JWT' })
  const payload = enc({ uid: 16, username: 'yumu', exp: Math.floor(Date.now() / 1000) + offsetSec })
  return `${header}.${payload}.not-a-real-signature`
}

/** 注入"看起来已登录"的本地状态。 */
const seedAuth = (t) => {
  localStorage.setItem('token', t)
  localStorage.setItem('userInfo', JSON.stringify({ id: 16, username: 'yumu', nickname: 'yumu', roles: ['ADMIN'] }))
}

/**
 * 🚨 只拦**真正打到后端的** /api 路径 —— 必须用函数匹配，不能用 glob！
 *
 * 踩过的坑：最初用「双星号 + /api/ + 双星号」这种 glob 拦接口，开头的双星号会吃掉 /src 前缀，
 * 于是源码模块 `http://localhost:5173/src/api/request.js` 也被当成接口拦下来，
 * 返回一段 JSON 冒充 JS → Vite 模块加载失败 → 整个应用白屏、一个业务请求都不发，
 * 而测试表现为"401 不弹提示、token 也没清"的一堆假红。
 * 源码模块的 pathname 是 /src/api/xxx.js，业务接口才是 /api/xxx —— 用 pathname 精确区分。
 */
const API_ROUTE = (u) => u.pathname.startsWith('/api/')

/** 记录整轮导航里**出现过的所有**消息（ElMessage 3 秒自动消失，事后查 DOM 会漏）。 */
const MESSAGE_RECORDER = () => {
  window.__msgs = []
  const record = () => {
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes || []) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('el-message')) {
            window.__msgs.push((n.textContent || '').replace(/\s+/g, ' ').trim())
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true })
  }
  if (document.body) record()
  else document.addEventListener('DOMContentLoaded', record)
}

/** 读走本轮记录到的全部消息并清空（便于分组统计）。 */
const takeMsgs = (page) =>
  page.evaluate(() => {
    const all = window.__msgs || []
    window.__msgs = []
    return all
  })

/** 布局探针：取输入框 / 按钮的几何信息（用于判定"是否同一行"）。 */
const geoProbe = (page) =>
  page.evaluate(() => {
    const box = (r) => ({ x: r.x, y: r.y, w: r.width, h: r.height, cy: r.y + r.height / 2 })
    const wraps = [...document.querySelectorAll('.login-card .el-input')]
    const btn = document.querySelector('.login-card .code-btn')
    return {
      fields: wraps.map((w) => {
        const inner = w.querySelector('.el-input__inner')
        return { placeholder: inner ? inner.placeholder : '', ...box(w.getBoundingClientRect()) }
      }),
      btn: btn ? box(btn.getBoundingClientRect()) : null
    }
  })

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const errors = []
  const page = await browser.newPage({ viewport: { width: 1080, height: 720 } })
  page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))
  await page.addInitScript(MESSAGE_RECORDER)

  // ---------------------------------------------------------------- A. 密码错误文案
  console.log('--- A. 登录失败必须报「账号或密码错误」 ---')
  await page.route(API_ROUTE, (route) => {
    if (route.request().url().endsWith('/auth/login')) {
      return route.fulfill(json(200, { code: 401, message: '账号或密码错误', data: null }))
    }
    return route.fulfill(json(200, { code: 200, message: 'ok', data: null }))
  })
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  await takeMsgs(page)
  const li = page.locator('.login-card .el-input__inner')
  await li.nth(0).fill('yumu')
  await li.nth(1).fill('definitely-wrong-password')
  await page.click('.submit')
  await page.waitForTimeout(1500)
  const aMsgs = await takeMsgs(page)
  ok(aMsgs.some((m) => m.includes('账号或密码错误')), `A1 透出后端原文案「账号或密码错误」（实际 ${JSON.stringify(aMsgs)}）`)
  ok(!aMsgs.some((m) => m.includes('登录已过期')), 'A2 不再误报「登录已过期」（修复前必现）')
  ok(!aMsgs.some((m) => m.includes('请求失败')), 'A3 也没有落到通用兜底文案')
  ok(!(await page.evaluate(() => !!localStorage.getItem('token'))), 'A4 登录失败不会写入任何 token')

  // ---------------------------------------------------------------- B. 并发 401 去重
  console.log('--- B. 首屏并发 401 只弹一条 ---')
  await page.unroute(API_ROUTE)
  let hit = 0
  await page.route(API_ROUTE, (route) => {
    hit++
    if (route.request().url().includes('/auth/refresh')) {
      return route.fulfill(json(200, { code: 401, message: '登录状态已失效，请重新登录', data: null }))
    }
    return route.fulfill(json(401, { code: 401, message: '未登录或登录已过期', data: null }))
  })
  await page.addInitScript(seedAuth, jwt(3600)) // 未过期（1h 后）→ 一定会真的发出去并撞 401
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const bMsgs = (await takeMsgs(page)).filter((m) => m.includes('登录已过期'))
  ok(hit >= 2, `B0 首屏确实并发了多个后端请求（拦截到 ${hit} 个）`)
  ok(bMsgs.length === 1, `B1 多条并发 401 只弹 1 条（实际 ${bMsgs.length} 条；拦截 ${hit} 个请求）`)
  ok(!(await page.evaluate(() => !!localStorage.getItem('token'))), 'B2 登录态仍被正常清理（只压提示，不压清理）')

  // ---------------------------------------------------------------- C. 主动退出后静默
  console.log('--- C. 主动退出登录后的在途 401 静默 ---')
  await page.unroute(API_ROUTE)
  await page.route(API_ROUTE, (route) => {
    // 退出登录本身要成功（后端恒返回 200）；其余接口一律 401，模拟"退出那一刻仍在途的请求陆续返回"
    if (route.request().url().includes('/auth/logout')) {
      return route.fulfill(json(200, { code: 200, message: 'ok', data: null }))
    }
    return route.fulfill(json(401, { code: 401, message: '未登录或登录已过期', data: null }))
  })
  await page.addInitScript(seedAuth, jwt(3600))
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await takeMsgs(page)
  // 走真实 store.logout()（与点「退出登录」同一条路径），再立刻发一个必然 401 的请求。
  // ⚠️ 这个请求**故意不传 _skipRenew**：要走完整的 401 处置链路才能验到静默窗口。
  await page.evaluate(async () => {
    const { useUserStore } = await import('/src/store/index.js')
    await useUserStore().logout()
    const { default: req } = await import('/src/api/request.js')
    await req.get('/posts').catch(() => {})
  })
  await page.waitForTimeout(1200)
  const cMsgs = await takeMsgs(page)
  ok(!cMsgs.some((m) => m.includes('登录已过期')), `C1 退出后的余波 401 不弹「登录已过期」（实际 ${JSON.stringify(cMsgs)}）`)
  ok(!(await page.evaluate(() => !!localStorage.getItem('token'))), 'C2 退出后登录态已清干净')

  // ---------------------------------------------------------------- D. 进站死 token
  // ⚠️ 在 /login 页做（不加载首页）—— 本组要验的是"进站那一刻就不该带着死 token 出去"，
  //    登录页同样会实例化 store，且不会发业务请求，干扰最小。
  console.log('--- D. 进站残留过期 token 静默清理 ---')
  await page.unroute(API_ROUTE)
  const errBeforeD = errors.length
  await page.addInitScript(seedAuth, jwt(-7200)) // 2 小时前就已过期 —— 隔天再打开网站的典型情况
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  const dMsgs = await takeMsgs(page)
  ok(!(await page.evaluate(() => localStorage.getItem('token'))), 'D1 残留的过期 token 已被清理（不再带着死 token 去撞 401）')
  ok(!dMsgs.some((m) => m.includes('登录已过期')), `D2 全程零「登录已过期」提示（实际 ${JSON.stringify(dMsgs)}）`)
  ok(errors.length === errBeforeD, `D3 进站清理过程无脚本硬错误（新增 ${errors.length - errBeforeD} 个）`)

  // ---------------------------------------------------------------- E. 忘记密码布局
  console.log('--- E. 忘记密码：按钮落在验证码行 ---')
  const errBeforeEF = errors.length
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.click('.forgot-row a')
  await page.waitForTimeout(600)
  const g = await geoProbe(page)
  const mail = g.fields.find((f) => f.placeholder === '绑定邮箱')
  const code = g.fields.find((f) => f.placeholder === '邮箱验证码（6 位）')
  ok(!!mail && !!code && !!g.btn, `E1 三个关键元素齐备（邮箱 ${!!mail} / 验证码 ${!!code} / 按钮 ${!!g.btn}）`)
  if (mail && code && g.btn) {
    ok(Math.abs(g.btn.cy - code.cy) < 6, `E2 「发送验证码」与验证码输入同行（Δy=${Math.abs(g.btn.cy - code.cy).toFixed(1)}px）`)
    ok(g.btn.x > code.x + code.w - 4, 'E3 按钮位于验证码输入框右侧')
    ok(Math.abs(mail.cy - code.cy) > 24, `E4 绑定邮箱独占一行（Δy=${Math.abs(mail.cy - code.cy).toFixed(1)}px）`)
    ok(mail.w > code.w + 24, `E5 邮箱输入框明显更宽（${mail.w.toFixed(0)}px vs 验证码 ${code.w.toFixed(0)}px）`)
  }

  // ---------------------------------------------------------------- F. 注册页同款布局
  console.log('--- F. 注册页：按钮落在验证码行 ---')
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.click('.tabs button:nth-child(2)')
  await page.waitForTimeout(600)
  const g2 = await geoProbe(page)
  const rMail = g2.fields.find((f) => f.placeholder === '邮箱')
  const rCode = g2.fields.find((f) => f.placeholder === '邮箱验证码（6 位）')
  ok(!!rMail && !!rCode && !!g2.btn, 'F1 三个关键元素齐备')
  if (rMail && rCode && g2.btn) {
    ok(Math.abs(g2.btn.cy - rCode.cy) < 6, `F2 「发送验证码」与验证码输入同行（Δy=${Math.abs(g2.btn.cy - rCode.cy).toFixed(1)}px）`)
    ok(g2.btn.x > rCode.x + rCode.w - 4, 'F3 按钮位于验证码输入框右侧')
    ok(rMail.w > rCode.w + 24, `F4 邮箱输入框独占整行（${rMail.w.toFixed(0)}px vs 验证码 ${rCode.w.toFixed(0)}px）`)
  }
  // 字段顺序不能因为布局调整而变（注册态：账号id → 密码 → 邮箱 → 验证码）
  const order = g2.fields.map((f) => f.placeholder)
  ok(
    order[0]?.startsWith('账号id') && order[1] === '密码' && order[2] === '邮箱' && order[3] === '邮箱验证码（6 位）',
    `F5 注册字段顺序未变 → ${JSON.stringify(order)}`
  )
  // 窄屏不能因为"邮箱独占整行"而横向溢出
  await page.setViewportSize({ width: 360, height: 720 })
  await page.waitForTimeout(600)
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok(ovf <= 1, `F6 360px 视口无横向溢出（溢出 ${ovf}px）`)

  // ---------------------------------------------------------------- G. 控制台
  console.log('--- G. 控制台 ---')
  // ⚠️ 只断言"登录页阶段"（E/F）无硬错误：B/C 组是**刻意伪造 401** 的首页，
  //    组件被灌进畸形响应本就会抛错，那是测试环境的噪声，不是产品缺陷。
  ok(errors.length === errBeforeEF, `G1 登录页两轮布局检查无脚本硬错误（新增 ${errors.length - errBeforeEF} 个）`)
  if (errors.length) console.log('   （全程错误快照，仅供参考）\n   ' + errors.join('\n   '))

  await browser.close()
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
  process.exit(fail ? 1 : 0)
})()

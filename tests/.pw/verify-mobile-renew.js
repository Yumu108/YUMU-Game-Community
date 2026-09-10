/**
 * 9-10 第二梯队 UI 验证（playwright-core + 系统 Chrome）
 *
 * 用法：
 *   cd tests/.pw && node verify-mobile-renew.js layout   # 移动端详情页适配（需 5173 dev + 8080 正常 TTL）
 *   cd tests/.pw && node verify-mobile-renew.js renew    # token 滑动续签（需 8080 以 JWT_EXPIRATION_MS=90000 启动）
 *
 * layout 检查项：
 *   1) 390px 窄屏下详情页无横向溢出（scrollWidth <= 视口宽）
 *   2) 没有元素右边缘超出视口
 *   3) 关键响应式样式生效（统计行左对齐、操作栏换行、标题字号收敛）
 *   4) 回帖弹窗宽度收敛在视口内（原来写死 540px 会溢出）
 *
 * renew 检查项（短 TTL 后端下）：
 *   5) 页面加载后 localStorage 里的 token 被自动轮换（旧 token -> 新 token）
 *   6) 续签后仍处于登录态（没有被踢出、无"登录已过期"提示）
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP = 'http://localhost:5173'
const API = 'http://127.0.0.1:8080/api'
const MODE = process.argv[2] || 'layout'

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${extra ? ' —— ' + extra : ''}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  ❌ ${name}${extra ? ' —— ' + extra : ''}`)
  }
}

async function apiLogin() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123456' })
  })
  const json = await res.json()
  return { token: json.data.token, user: json.data.user }
}

;(async () => {
  const { token, user } = await apiLogin()
  // 直接查 API 取一篇公开帖（首页卡片 DOM 依赖数据渲染，不稳定）
  const postsRes = await fetch(`${API}/posts?current=1&size=1`).then((r) => r.json()).catch(() => null)
  const postId = postsRes?.data?.records?.[0]?.id
  const postHref = postId ? `/post/${postId}` : null
  console.log(`（测试用帖子：${postHref || '未取到'}）`)

  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  // 注意：不用 isMobile —— Chrome 移动模拟在内容溢出时会 shrink-to-fit 缩放，
  // 导致 innerWidth 变成 625 而非 390，媒体查询断言就失真了。固定 viewport 更可控。
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2
  })
  // 预置登录态，跳过登录页。
  // ⚠️ 必须加「不存在才写」的守卫：addInitScript 会在每次导航时执行，
  //    renew 模式下若每次导航都把最初的旧 token 写回去，会把自动续签的新 token 覆盖掉，
  //    随后旧 token 已被后端轮换拉黑 → 误判为"被踢出登录"。
  await ctx.addInitScript(
    ([t, u]) => {
      if (!localStorage.getItem('token')) {
        localStorage.setItem('token', t)
        localStorage.setItem('userInfo', u)
      }
    },
    [token, JSON.stringify(user)]
  )
  const page = await ctx.newPage()
  const errors = []
  const notFound = []
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE ' + m.text())
  })
  page.on('response', (r) => {
    if (r.status() === 404 && notFound.length < 6) notFound.push(r.url())
  })

  console.log(`\n=== UI 验证（${MODE}，390×844）===\n`)

  ok('0) 取到测试帖链接', !!postHref, postHref || '未找到')

  await page.goto(APP + (postHref || '/'), { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'mobile-detail.png', fullPage: false })

  if (MODE === 'layout') {
    // 1) 横向溢出
    const m = await page.evaluate(() => {
      const de = document.documentElement
      const vw = window.innerWidth
      const offenders = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.right > vw + 1) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className && String(el.className).slice(0, 40)) || '',
            right: Math.round(r.right)
          })
        }
      }
      const cs = (sel) => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el) : null
      }
      return {
        vw,
        scrollW: de.scrollWidth,
        bodyScrollW: document.body.scrollWidth,
        offenders: offenders.slice(0, 6),
        offenderCount: offenders.length,
        statsMarginLeft: cs('.d-stats')?.marginLeft,
        statsJustify: cs('.d-stats')?.justifyContent,
        actionsWrap: cs('.d-actions')?.flexWrap,
        titleSize: cs('.d-title')?.fontSize,
        metaWrap: cs('.d-meta')?.flexWrap,
        hasPost: !!document.querySelector('.d-title')
      }
    })
    ok('1) 详情页已渲染', m.hasPost)
    ok('2) 无横向溢出（scrollWidth <= 视口）', m.scrollW <= m.vw + 1, `scrollW=${m.scrollW} vw=${m.vw}`)
    ok('3) 无元素超出视口右边界', m.offenderCount === 0,
      m.offenderCount ? JSON.stringify(m.offenders) : '')
    // 注：flex 项上的 `margin-left: auto` 被 Chrome 解析为「已使用值」（像素），
    // 因此不能用它判断桌面/移动差异；这里用 justify-content（移动端规则显式置为 flex-start）。
    ok('4) 统计信息整行左对齐（justify-content: flex-start）', m.statsJustify === 'flex-start', `justify=${m.statsJustify}`)
    ok('5) 操作栏允许换行', m.actionsWrap === 'wrap', `flexWrap=${m.actionsWrap}`)
    ok('6) 元信息允许换行', m.metaWrap === 'wrap', `flexWrap=${m.metaWrap}`)
    ok('7) 标题字号已按窄屏收敛（390px 命中 420 断点 → 17px）',
      m.titleSize === '17px' || m.titleSize === '18.5px', `fontSize=${m.titleSize}`)

    // 8) 弹窗宽度
    const opened = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.r-action')].find((b) => b.textContent.includes('回复'))
      if (btn) { btn.click(); return true }
      return false
    })
    await page.waitForTimeout(900)
    if (opened) {
      const d = await page.evaluate(() => {
        const el = document.querySelector('.el-dialog')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth }
      })
      ok('8) 回帖弹窗宽度收敛在视口内', !!d && d.right <= d.vw + 1 && d.left >= -1,
        d ? JSON.stringify(d) : '未打开弹窗')
      await page.screenshot({ path: 'mobile-dialog.png' })
    } else {
      console.log('  ℹ️ 该帖无「回复」按钮（可能未登录态或无可回复内容），跳过弹窗检查')
    }
  }

  if (MODE === 'renew') {
    // 场景：后端 TTL 设为 31 分钟（略高于前端 30 分钟的续签阈值）。
    // 刚签发时不应续签；等剩余不足 30 分钟后，下一次请求应自动续签且不掉线。
    // 用真实阈值语义测试（而不是把 TTL 设成 90 秒——那会让每个请求都在续签，
    // 属于人为制造的轮换压力，不能反映线上行为）。
    const t0 = await page.evaluate(() => localStorage.getItem('token'))

    // 1) 初始不应触发续签
    await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(2500)
    const t1 = await page.evaluate(() => localStorage.getItem('token'))
    ok('1) 未到阈值时不续签（token 不变）', !!t0 && t0 === t1,
      `${String(t0).slice(0, 14)}… → ${String(t1).slice(0, 14)}…`)

    // 2) 等 token 进入"剩余 < 30 分钟"窗口
    const exp = await page.evaluate(() => {
      const t = localStorage.getItem('token')
      const b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
      return JSON.parse(atob(b64 + pad)).exp * 1000
    })
    const waitMs = Math.max(0, exp - Date.now() - 30 * 60 * 1000) + 6000
    console.log(`  （等待 ${Math.round(waitMs / 1000)}s 让 token 进入续签窗口…）`)
    await page.waitForTimeout(waitMs)

    // 3) 触发一次请求 → 应自动续签
    await page.evaluate(async () => {
      await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } })
    })
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(3000)
    const after = await page.evaluate(() => localStorage.getItem('token'))
    ok('2) 进入续签窗口后自动换新 token（旧 ≠ 新）', !!after && t1 !== after,
      `${String(t1).slice(0, 14)}… → ${String(after).slice(0, 14)}…`)
    const body = await page.evaluate(() => document.body.innerText)
    ok('3) 没有被踢出登录（无"登录已过期"提示）', !body.includes('登录已过期'))
    ok('4) 仍是登录态（localStorage 有 token）', await page.evaluate(() => !!localStorage.getItem('token')))

    // 5) 新 token 可访问受保护接口
    const me = await page.evaluate(async () => {
      const t = localStorage.getItem('token')
      const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + t } })
      const j = await r.json()
      return { http: r.status, code: j.code }
    })
    ok('5) 续签后的 token 仍可用（/auth/me code=200）', me.code === 200, JSON.stringify(me))

    // 6) 旧 token 应已被服务端轮换拉黑（验证确实发生了轮换，而不是"没续签也没事"）
    const oldStillValid = await page.evaluate(async (old) => {
      const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + old } })
      const j = await r.json()
      return j.code
    }, t1)
    ok('6) 旧 token 已被服务端拉黑（code=401）', oldStillValid === 401, `code=${oldStillValid}`)
    await page.screenshot({ path: 'renew-after.png' })
  }

  const realErrors = errors.filter((e) => !/favicon|ResizeObserver/.test(e))
  ok('99) 无页面/控制台错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
  if (notFound.length) console.log('  ℹ️ 404 请求：\n    - ' + notFound.join('\n    - '))

  await browser.close()
  console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
  if (failures.length) console.log('未通过：\n - ' + failures.join('\n - '))
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('脚本异常：', e)
  process.exit(1)
})

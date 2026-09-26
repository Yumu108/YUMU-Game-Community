/**
 * 探针：「我的」页权限卡截图 + 文案清点（按角色）
 *
 * 为什么单独写一个：改「我的权限」卡的文案时，**需要一张「改后长什么样」的图**给用户看，
 * 而界面回归（`verify-miniprogram.cjs`）只断言元素与请求，不产出这种「给人看」的卡片图。
 *
 * 做法沿用 `probe-report-sheet.cjs` 的**本地会话注入**（门禁只读本机 `yumu_user`）：
 *   ⚠️ uni-app H5 的存储是 `{type,data}` 信封，直接 JSON.stringify(obj) 读不出来。
 *
 * 用法：
 *   MP_BASE=http://localhost:5199/m node tests/.pw/probe-my-card.cjs            # 版主（默认）
 *   ROLE=admin MP_BASE=http://8.133.255.202/m node tests/.pw/probe-my-card.cjs
 *   ROLE=user|moderator|admin        （版主默认带一个模拟的负责游戏名）
 *
 * 输出：`docs/screenshots/my-card-<role>.png` + 控制台打印卡片各块文本。
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = (process.env.MP_BASE || 'http://localhost:5199/m').replace(/\/$/, '')
const ROLE = (process.env.ROLE || 'moderator').toLowerCase()
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT_DIR = path.resolve(__dirname, '../../docs/screenshots')

/**
 * 🚨 假身份**必须带 `id`**：`store.js#getUser()` 的判据是 `u && u.id ? u : null`，
 *    少了 `id` 会被**静默**当作游客 —— 现象（「我的」页显示访客模式、`页面开头` 打印
 *    访客模式，注入键却还在 localStorage 里）看起来**完全像注入没生效**，极易误判。
 *    这也是 `probe-report-sheet.cjs` 当年没事的原因（它那份里带了 `id: 1`）。
 */
const PROFILES = {
  user: { id: 90001, roles: ['USER'], nickname: '普通用户', username: 'plainuser' },
  moderator: {
    id: 1005,
    roles: ['MODERATOR'],
    nickname: 'yumu',
    username: 'yumu',
    moderatorGameNames: ['城市：天际线2'],
    moderatorGameIds: [17]
  },
  admin: { id: 1, roles: ['ADMIN'], nickname: 'admin', username: 'admin' }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const me = PROFILES[ROLE]
  if (!me) {
    console.error(`❌ 未知 ROLE=${ROLE}（可选：${Object.keys(PROFILES).join(' / ')}）`)
    process.exit(1)
  }
  if (!fs.existsSync(CHROME)) {
    console.error(`❌ 找不到 Chrome：${CHROME}（可用 CHROME=... 覆盖）`)
    process.exit(1)
  }

  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e && e.message)))

  // 🚨 注入时机很关键：**必须用 `addInitScript` 在页面脚本执行前写入**。
  //    试过「先 goto 再 evaluate 写 storage」——「我的」页的 `onShow` 会跑一轮会话同步，
  //    可能在写入之后把它冲掉（同一个写法有时成功有时失败，实测不可靠）。
  //    `addInitScript` 在**每个 document 的脚本之前**执行 ⇒ 应用启动读到的就是这份身份。
  //    ⚠️ 它在 about:blank 等不透明源上访问 localStorage 会抛，必须 try/catch。
  await page.addInitScript((payload) => {
    try {
      localStorage.setItem('yumu_user', JSON.stringify({ type: 'object', data: payload }))
    } catch (e) {
      /* 不透明源忽略 */
    }
  }, me)

  await page.goto(`${BASE}/?t=${Date.now()}#/pages/my/my`, { waitUntil: 'domcontentloaded' })
  await sleep(3200)

  const dump = await page.evaluate(() => {
    const txt = (sel) => {
      const el = document.querySelector(sel)
      return el ? el.innerText.replace(/\s+/g, ' ').trim() : null
    }
    return {
      hasCard: !!document.querySelector('.perm'),
      // 诊断用：注入是否还在 + 页面开头文本（能一眼看出是不是掉回「访客模式」）
      storageKeys: Object.keys(localStorage),
      bodyStart: document.body.innerText.replace(/\s+/g, ' ').slice(0, 140),
      head: txt('.perm__head'),
      scope: txt('.scope'),
      matrixHead: txt('.mx__head'),
      matrixSum: txt('.mx__sum'),
      hint: txt('.perm__hint'),
      // 这两块是本次要确认**已消失**的
      legacyRows: document.querySelectorAll('.perm__row').length,
      legacyNote: document.querySelectorAll('.perm__note').length,
      // 卡片整体文本，供人眼比对
      cardText: txt('.perm')
    }
  })

  console.log(`\n=== ROLE=${ROLE}  BASE=${BASE} ===`)
  console.log("storage      :", dump.storageKeys)
  console.log("页面开头      :", dump.bodyStart)
  console.log("卡存在        :", dump.hasCard)
  console.log('页头          :', dump.head)
  console.log('管辖范围      :', dump.scope)
  console.log('矩阵标题      :', dump.matrixHead)
  console.log('矩阵摘要      :', dump.matrixSum)
  console.log('管理入口提示  :', dump.hint)
  console.log('--- 应已删除 ---')
  console.log('.perm__row 数 :', dump.legacyRows, dump.legacyRows === 0 ? '✅' : '❌ 仍在')
  console.log('.perm__note数 :', dump.legacyNote, dump.legacyNote === 0 ? '✅' : '❌ 仍在')
  console.log('pageerror     :', errors.length ? errors.join(' | ') : '0 ✅')

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, `my-card-${ROLE}.png`)
  await page.screenshot({ path: out, fullPage: true })
  console.log(`\n截图 → ${out}`)

  await browser.close()
  process.exit(dump.hasCard && dump.legacyRows === 0 && dump.legacyNote === 0 ? 0 : 1)
})()

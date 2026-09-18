/**
 * 专项回归：「保存资料后账号信息被抹掉」（9-18 修）。
 *
 * 复现路径：登录 → 个人中心 → 账号设置 → 改昵称 → 点「保存资料」
 * 故障现象（用户实测截图）：保存后用户卡片变「账号id:—」、🛡️ 管理员标消失、
 *   右侧「当前账号」空白、改账号入口被误判成「今年已改过」而锁死。
 * 根因：saveProfile() 用「手写白名单」对象整体覆盖 userStore.userInfo，
 *   没有展开 base ⇒ username / nickname / badge / email / canChangeUsername 静默丢失。
 *
 * 判据刻意**不落在「页面上有没有这个元素」**（这类故障的特征恰恰是「页面看起来很正常」），
 * 而是落在**事实**上：localStorage 里那份 userInfo 的字段值 + 接口返回：
 *   A. 保存后 store 仍有 username=admin（不是空串/undefined）
 *   B. store 仍有 badge=ADMIN、roles 含 ADMIN（权限 getter 依赖它）
 *   C. store 的 canChangeUsername 没有被 undefined 掉
 *   D. 页面「账号id:xxx」显示的确实是账号
 *   E. 「当前账号」显示的确实是账号
 *   F. 管理员徽章仍在
 *   G. 昵称**确实改成功了** —— 否则「没保存所以没坏」会伪装成通过
 * 收尾：把昵称改回原值，不污染本机数据。全程控制台零错误。
 *
 * 运行：cd tests/.pw && WEB_BASE=http://localhost:5199 node verify-my-profile-save.js
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PW = process.env.TEST_ADMIN_PASSWORD || 'admin123456'

let pass = 0, fail = 0
const fails = []
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅', name, extra) }
  else { fail++; fails.push(name); console.log('  ❌', name, extra) }
}

/**
 * 保存资料时**不应发生变化**的字段。
 * 断言方式：保存前后取这些键的快照，要求完全相等 —— 这是本 bug 的一般化形式
 * （旧代码就是把这些字段里的 username/badge/canChangeUsername 抹掉了）。
 * ⚠️ 不要写成「email 必须非空」这种依赖具体账号数据的脆弱断言：
 *    admin 本来就没绑邮箱（DB 里 email 为 NULL），那样会功能正常却报红。
 */
const PRESERVE_KEYS = [
  'id', 'username', 'email', 'gender', 'badge', 'badgeColor', 'badgeText',
  'activityLevel', 'activityTitle', 'points',
  'moderatorBoardIds', 'moderatorBoardNames', 'moderatorGameNames',
  'canChangeUsername'
]
const pick = (obj, keys) => keys.reduce((o, k) => { o[k] = obj?.[k]; return o }, {})

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)) })
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))

  const readStore = () => page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('userInfo') || '{}') } catch { return {} }
  })
  const readUi = () => page.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const roleEls = [...document.querySelectorAll('.u-role')]
    return {
      accountIdText: (q('.u-account')?.textContent || '').trim(),   // 「账号id:admin」
      curAccount: (q('.acc-now')?.textContent || '').trim(),        // 「当前账号」右侧值
      nameText: (q('.u-name span')?.textContent || '').trim(),      // 用户卡片昵称
      roleTexts: roleEls.map((e) => e.textContent.trim()),
      hasSaveBtn: !!q('.set-form button')
    }
  })

  const loginAs = async (user, pwd) => {
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(1000)
    await page.evaluate(() => localStorage.clear())
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(1000)
    const ins = page.locator('.login-card .el-input__inner')
    await ins.nth(0).fill(user)
    await ins.nth(1).fill(pwd)
    await page.click('.submit')
    await page.waitForTimeout(2000)
  }
  const openSettings = async () => {
    await page.goto(BASE + '/my', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(1800)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.tabs button')].find((x) => /账号设置/.test(x.textContent))
      if (b) b.click()
    })
    await page.waitForTimeout(1000)
  }
  /** 改昵称并保存；等「资料已保存」提示或超时。 */
  const saveNickname = async (val) => {
    const nick = page.locator('.set-form .el-input__inner').nth(0)
    await nick.fill(val)
    await page.locator('.set-form button:has-text("保存资料")').click()
    await page.waitForTimeout(2200)   // 保存 + syncMe() 权威校正
  }

  console.log('--- 登录 admin ---')
  await loginAs(ADMIN_USER, ADMIN_PW)
  if (!(await page.evaluate(() => !!localStorage.getItem('token')))) {
    console.log('❌ 登录失败：确认后端在跑（8080）且 TEST_ADMIN_PASSWORD 正确')
    await browser.close(); process.exit(1)
  }
  await openSettings()
  const storeBefore = await readStore()
  const origNick = storeBefore.name || '管理'
  const before = await readUi()
  console.log('  基线：昵称=%s 账号id=%s 当前账号=%s 徽章=%s',
    origNick, before.accountIdText, before.curAccount, JSON.stringify(before.roleTexts))

  // ---------------- 核心：改一次昵称并保存 ----------------
  const NEW_NICK = origNick.endsWith('T') ? origNick.slice(0, -1) : origNick + 'T'
  console.log(`--- 改成「${NEW_NICK}」并保存 ---`)
  await saveNickname(NEW_NICK)
  const after = await readUi()
  const s = await readStore()

  console.log('  保存后：昵称=%s 账号id=%s 当前账号=%s 徽章=%s',
    s.name, after.accountIdText, after.curAccount, JSON.stringify(after.roleTexts))

  console.log('--- A~G. 事实型断言 ---')
  // G 先判：证明保存真的生效了（否则其余"没坏"毫无意义）
  ok('G 昵称确实改成功（证明保存生效）', s.name === NEW_NICK, `store.name=${s.name}`)
  ok('G UI 昵称同步更新', after.nameText === NEW_NICK, `dom=${after.nameText}`)
  // A：最核心 —— username 不能被抹掉
  ok('A store 仍有 username（未被抹掉）', s.username === ADMIN_USER, `username=${JSON.stringify(s.username)}`)
  // B：权限相关
  ok('B store 仍有 badge=ADMIN', s.badge === 'ADMIN', `badge=${JSON.stringify(s.badge)}`)
  ok('B store 的 roles 仍含 ADMIN', Array.isArray(s.roles) && s.roles.includes('ADMIN'), `roles=${JSON.stringify(s.roles)}`)
  // C：改账号入口不被误锁
  ok('C canChangeUsername 未被 undefined 掉', s.canChangeUsername !== undefined && s.canChangeUsername !== null,
    `canChangeUsername=${JSON.stringify(s.canChangeUsername)}`)
  // D/E/F：界面上看得见的那几处
  ok('D 页面「账号id:」显示 admin', /账号id[:：]\s*admin/.test(after.accountIdText.replace(/\s+/g, '')), after.accountIdText)
  ok('E 右侧「当前账号」显示 admin', after.curAccount === ADMIN_USER, `当前账号=${JSON.stringify(after.curAccount)}`)
  ok('F 🛡️ 管理员徽章仍在', after.roleTexts.some((t) => /管理员/.test(t)), JSON.stringify(after.roleTexts))
  // 附：一般化不变量 —— 保存资料不该动到任何「非资料」字段
  const pb = pick(storeBefore, PRESERVE_KEYS)
  const pa = pick(s, PRESERVE_KEYS)
  const diff = PRESERVE_KEYS.filter((k) => JSON.stringify(pb[k]) !== JSON.stringify(pa[k]))
  ok('附 保存前/后「不应变化字段」完全一致', diff.length === 0,
    diff.length ? diff.map((k) => `${k}: ${JSON.stringify(pb[k])} → ${JSON.stringify(pa[k])}`).join('; ') : `${PRESERVE_KEYS.length} 个键一致`)

  await page.screenshot({ path: 'shots/profile-save-after.png' }).catch(() => {})

  // ---------------- 收尾：改回原昵称并复核 ----------------
  console.log('--- 收尾：改回原昵称 ---')
  await saveNickname(origNick)
  const s2 = await readStore()
  ok('收尾：昵称已还原', s2.name === origNick, `store.name=${s2.name}`)
  ok('收尾：还原后 username/badge 仍完好', s2.username === ADMIN_USER && s2.badge === 'ADMIN',
    `username=${s2.username} badge=${s2.badge}`)

  console.log('--- 控制台 ---')
  ok('全程控制台零错误', errs.length === 0, errs.slice(0, 3).join(' | '))

  await browser.close()
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  if (fail) { console.log('失败项：' + fails.join('、')); process.exit(1) }
})()

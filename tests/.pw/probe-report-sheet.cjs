/**
 * 举报弹层交互探针（H5 端）—— 2026-09-26 新增，服务于「点选项就自动退出」那个 bug。
 *
 * 为什么单独一个探针、而不是并进 143 项回归：
 *   弹层要**登录后**才打得开，而回归跑的是线上（生产库），不能拿真账号去点举报（会写 `report` 表）。
 *   这里用**本地会话注入**绕过登录：门禁 `requireLogin` 只读本机 `yumu_user`，
 *   塞一个假用户就能把弹层打开 —— 于是「开层 / 点选项 / 点遮罩 / 点取消」这四条交互全部可验，
 *   且**不发任何写请求**（不点「提交举报」）。
 *
 * ⚠️ 边界（如实说明）：本探针跑的是 **H5（Chromium）**。用户报的那个 bug 出在**小程序端**
 *   （`@click.self` 被 uni-app 静默丢弃 ⇒ `bindtap` 冒泡关层）。小程序端无法自动化，
 *   那边的证据是**编译产物**：`dist/build/mp-weixin/pages/post/detail.wxml` 里
 *   `.rsheet` 容器上**没有 bindtap**、`.rsheet__mask` 有独立 bindtap。
 *   源头防复发靠 `npm run lint:mp`（禁止 `.self`）。
 *
 * 跑法（先起本地静态服务：node tests/serve-h5.mjs）：
 *   MP_BASE=http://localhost:5199/m NODE_PATH='E:\2kewai\YUMUGameCommunity\tests\.pw\node_modules' \
 *     node tests/.pw/probe-report-sheet.cjs
 */
const { chromium } = require('playwright-core')
const path = require('path')

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.MP_BASE || 'http://localhost:5199/m'
/** 截图落点：给人看「修完长什么样」（与回归的 shots 放一起） */
const SHOTS = process.env.SHOT_DIR || 'E:/2kewai/YUMUGameCommunity/miniprogram/tests/shots'

const pass = []
const fail = []
/**
 * 🚨 判据必须**真的参与判定**。本探针第一版把签名写成 `(n, extra)`，
 *   调用时传的是 `(n, cond, extra)` ⇒ `cond` 被当成 `extra` 打印、断言**无条件通过**，
 *   于是它报了个假的 14/14（正是本项目反复告警的「空转断言」）。
 *   所以这里显式收 `cond`，并且**立刻打印**，不攒到最后才输出。
 */
const ok = (n, cond, extra = '') => {
  const line = `${cond ? '✅' : '❌'} ${n}${extra ? `  [${extra}]` : ''}`
  ;(cond ? pass : fail).push(line)
  console.log(line)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  const errs = []
  const writes = []
  /** 4xx/5xx 资源（只记录 URL，便于 P14 报错时**能定位**，而不是只丢一句 "404"） */
  const badRes = []
  page.on('response', (r) => {
    if (r.status() >= 400) badRes.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`)
  })
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
  page.on('console', (m) => {
    // 带 location：只记 "404" 而不记出处等于没记（本次就靠它定位到了源头）
    if (m.type() === 'error') {
      const loc = m.location() || {}
      errs.push(`CONSOLE ${m.text().slice(0, 110)} @${loc.url || '?'}:${loc.lineNumber || 0}`)
    }
  })
  // 只观察，不断言：探针本身不该往生产库写东西
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\//.test(r.url())) writes.push(r.method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, ''))
  })

  // 取一条真实帖子的 id（用它打开详情页）
  await page.goto(`${BASE}/?t=${Date.now()}#/pages/index/index`, { waitUntil: 'domcontentloaded' })
  await sleep(3000)
  const postId = await page.evaluate(async () => {
    const r = await fetch('/api/posts?boardId=1&sort=latest&current=1&size=1').then((x) => x.json()).catch(() => null)
    return r && r.data && r.data.records && r.data.records[0] ? r.data.records[0].id : null
  })
  if (!postId) {
    ok('拿到候选帖子 id（详情页前置条件）', false, '接口没返回任何帖子')
    await browser.close()
    process.exit(1)
  }

  // 注入本地会话：门禁只读本机 yumu_user，不看服务端 ⇒ 足以把弹层打开
  // ⚠️ uni-app H5 的存储是 `{type, data}` 信封（见 uniapp-h5-traps 技能），
  //    直接 `localStorage.setItem(key, JSON.stringify(obj))` 是**读不出来**的。
  //    这里按信封格式写；页面侧的 `uni.getStorageSync` 才会正确解包。
  await page.evaluate(() => {
    localStorage.setItem(
      'yumu_user',
      JSON.stringify({ type: 'object', data: { id: 1, username: 'probe', nickname: 'probe', avatar: '' } })
    )
  })
  // （注入是否成功由 P2 反证：门禁放行了才打得开弹层）

  await page.goto(`${BASE}/?t=${Date.now()}#/pages/post/detail?id=${postId}`, { waitUntil: 'domcontentloaded' })
  await sleep(3200)

  const n = (sel) => page.$$eval(sel, (els) => els.length)
  const cls = async (sel, i = 0) =>
    page.$$eval(sel, (els, k) => (els[k] ? els[k].className : ''), i)

  ok('P1 详情页渲染出举报入口', (await n('.author__report')) === 1, `report=${await n('.author__report')}`)

  await page.click('.author__report')
  await sleep(600)
  ok('P2 点举报打开弹层（门禁放行）', (await n('.rsheet')) === 1, `rsheet=${await n('.rsheet')}`)
  ok('P3 弹层是「独立遮罩 + 面板」结构', (await n('.rsheet__mask')) === 1 && (await n('.rsheet__panel')) === 1)
  const opts = await page.$$eval('.rsheet__opt', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
  ok('P4 预置 5 个举报理由', opts.length === 5, opts.join(' / '))

  // ★ 核心：点选项**不能**关层（用户报的正是「一点选项就退回帖子」）
  await page.click('.rsheet__opt:nth-child(3)') // 第 1 个 child 是标题，故从第 3 个起是选项
  await sleep(500)
  ok(
    'P5 点理由选项后弹层仍开着（未被冒泡误关）',
    (await n('.rsheet')) === 1,
    `rsheet=${await n('.rsheet')}`
  )
  const onIdx = await page.$$eval('.rsheet__opt', (els) =>
    els.findIndex((e) => e.className.includes('rsheet__opt--on'))
  )
  ok('P6 被点的选项变成选中态（只有一个）', onIdx === 0 && (await n('.rsheet__opt--on')) === 1, `选中序号=${onIdx}`)
  ok('P7 选中项显示对勾', (await n('.rsheet__check')) === 1)

  // 换一个选项：选中态要**转移**，不是叠加
  await page.click('.rsheet__opt:nth-child(4)')
  await sleep(400)
  const onIdx2 = await page.$$eval('.rsheet__opt', (els) =>
    els.findIndex((e) => e.className.includes('rsheet__opt--on'))
  )
  ok('P8 改选后选中态转移（不叠加）', onIdx2 === 1 && (await n('.rsheet__opt--on')) === 1, `选中序号=${onIdx2}`)
  ok('P9 全程弹层都在（连点两次选项都不误关）', (await n('.rsheet')) === 1)
  // 留一张「选中状态 + 弹层仍然开着」的截图 —— 正是用户报的那个场景
  await page.screenshot({ path: path.join(SHOTS, 'P-report-sheet-选中.png') })

  // 点面板空白处（标题）也不该关
  await page.click('.rsheet__title')
  await sleep(400)
  ok('P10 点面板非交互区也不误关', (await n('.rsheet')) === 1, `rsheet=${await n('.rsheet')}`)

  // 点遮罩必须能关
  await page.click('.rsheet__mask', { position: { x: 10, y: 10 } })
  await sleep(500)
  ok('P11 点遮罩关闭弹层', (await n('.rsheet')) === 0, `rsheet=${await n('.rsheet')}`)

  // 「取消」也必须能关
  await page.click('.author__report')
  await sleep(500)
  const cancelBtn = (await page.$$('.rsheet__btn'))[0]
  if (cancelBtn) await cancelBtn.click()
  await sleep(500)
  ok('P12 「取消」关闭弹层', (await n('.rsheet')) === 0, `rsheet=${await n('.rsheet')}`)

  // 重新打开：选中态应被重置（不该记得上次的选择）
  await page.click('.author__report')
  await sleep(500)
  ok('P13 重开弹层时选中态已重置', (await n('.rsheet__opt--on')) === 0 && (await n('.rsheet')) === 1)

  // ⚠️ 本地静态服务（serve-h5.mjs）不提供 favicon ⇒ `/favicon.ico` 404 会被浏览器记成
  //    console error。那是**探针环境**的产物，不是应用问题，排除掉并在标题里写明，
  //    免得以后有人看到"零报错"这条被绕过来绕过去。
  const realErrs = errs.filter((e) => !/favicon\.ico/.test(e))
  ok('P14 全程零 JS 运行时报错（已排除本地 favicon 404）', realErrs.length === 0, realErrs.slice(0, 3).join(' | '))
  // 404/5xx 单独一条，**必须带 URL** —— 只报 "404" 等于没报
  ok(
    'P15 全程无 4xx/5xx 资源',
    badRes.length === 0,
    badRes.length ? `${badRes.length} 个：${[...new Set(badRes)].slice(0, 4).join(' , ')}` : '0 个'
  )
  void cls

  if (fail.length) console.log('\n' + fail.join('\n'))
  console.log(`\n=== 结果：${pass.length}/${pass.length + fail.length} 通过 ===`)
  if (writes.length) {
    // 探针不应产生写请求：只点选项 / 遮罩 / 取消，从不点「提交举报」
    console.log(`⚠️ 意外产生了写请求（应为空）：${writes.join(' , ')}`)
  } else {
    console.log('（未产生任何 POST 写请求 —— 探针不动生产数据）')
  }

  await browser.close()
  process.exit(fail.length === 0 ? 0 : 1)
})().catch((e) => {
  console.error('探针异常：', e)
  process.exit(1)
})

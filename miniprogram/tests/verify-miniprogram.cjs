/**
 * 小程序 H5 端浏览器回归（打在**真实构建产物**上，不是 dev server）。
 *
 * 前置：
 *   1) cd miniprogram && npm run build:h5
 *   2) node tests/serve-h5.mjs          # 起在 http://localhost:5199/m/
 *   3) 跑本脚本：
 *      NODE_PATH="<repo>/tests/.pw/node_modules" node tests/verify-miniprogram.cjs
 *
 * 复用 frontend 项目已装好的 playwright-core（避免重复安装）：
 *   NODE_PATH 指向仓库根的 tests/.pw/node_modules。
 *
 * 可选环境变量：MP_BASE（默认 http://localhost:5199/m）、CHROME（Chrome 路径）
 */
const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright-core')

const EXE = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.MP_BASE || 'http://localhost:5199/m'
const SHOTS = path.join(__dirname, 'shots')
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true })

let pass = 0
let fail = 0
function assert(name, cond, extra = '') {
  const ok = !!cond
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  [' + extra + ']' : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  })
  const page = await ctx.newPage()

  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE-ERR ' + m.text())
  })

  const count = async (sel) => page.$$eval(sel, (els) => els.length)
  const text = async (sel) => (await page.$(sel)) ? (await page.$eval(sel, (el) => el.innerText)) : ''
  const goto = async (hash) => {
    // 🚨 必须带一个变化的 query 强制**整页重载**：
    //    只改 hash 的话浏览器不会重新加载文档，SPA 会带着上一节的状态（筛选/滚动位置）继续跑，
    //    实测导致「上拉加载」一节假失败（还停在上一节的 PC 筛选，5 条已是全部）。
    await page.goto(`${BASE}/?t=${Date.now()}#${hash}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(2600)
  }

  /* ================= A. 首页 ================= */
  console.log('\n--- A. 首页 ---')
  await goto('/pages/index/index')
  assert('A1 搜索入口渲染', await count('.search') >= 1)
  const hotN = await count('.gcard')
  assert('A2 热门游戏横滑有内容', hotN >= 3, `gcard=${hotN}`)
  const pcN = await count('.pc')
  assert('A3 资讯 + 攻略列表有帖子', pcN >= 4, `pc=${pcN}`)
  assert('A4 页面含「热门游戏」标题', (await page.content()).includes('热门游戏'))
  assert('A5 统计条渲染', await count('.stats__item') === 3)
  await page.screenshot({ path: path.join(SHOTS, 'A-home.png') })

  /* ================= B. 详情页 · 要点卡 ================= */
  console.log('\n--- B. 详情页（核心亮点：拆解卡）---')
  await goto('/pages/post/detail?id=3005')
  const stepN = await count('.step')
  assert('B1 要点卡渲染 ≥2 张', stepN >= 2, `step=${stepN}`)
  const modeTxt = await text('.modebar')
  assert('B2 模式条含「要点模式」', modeTxt.includes('要点模式'), modeTxt.replace(/\s+/g, ' ').slice(0, 30))
  assert('B3 详情页有正文标题', (await text('.title')).length > 4)
  await page.screenshot({ path: path.join(SHOTS, 'B-detail-card.png') })

  // 切到原文模式
  const modeBtns = await page.$$('.modebar__btn')
  if (modeBtns.length >= 2) {
    await modeBtns[1].click()
    await sleep(600)
    const stepAfter = await count('.step')
    const pAfter = await count('.content__p')
    assert('B4 切「原文模式」后卡片消失、段落出现', stepAfter === 0 && pAfter >= 1, `step=${stepAfter} p=${pAfter}`)
    await page.screenshot({ path: path.join(SHOTS, 'B-detail-raw.png') })
    await modeBtns[0].click()
    await sleep(600)
    assert('B5 切回后卡片恢复', (await count('.step')) >= 2)
  } else {
    assert('B4 模式切换按钮存在', false)
    assert('B5 切回后卡片恢复', false)
  }

  // 收藏（本地存储）
  const favBtns = await page.$$('.fab__btn')
  if (favBtns.length >= 2) {
    await favBtns[1].click()
    await sleep(500)
    const favTxt = (await page.$eval('.fab', (el) => el.innerText)).replace(/\s+/g, '')
    assert('B6 点击收藏后文案变为「已收藏」', favTxt.includes('已收藏'), favTxt)
    await favBtns[1].click()
    await sleep(500)
    const favTxt2 = (await page.$eval('.fab', (el) => el.innerText)).replace(/\s+/g, '')
    assert('B7 再点取消收藏', !favTxt2.includes('已收藏'), favTxt2)
  } else {
    assert('B6 收藏按钮存在', false)
    assert('B7 再点取消收藏', false)
  }

  // 步骤模式（显式序号）—— 用合成内容无法测，这里断言 3001 也是可拆解的
  await goto('/pages/post/detail?id=3001')
  assert('B8 #3001 同样可拆解', (await count('.step')) >= 2, `step=${await count('.step')}`)

  /* ================= C. 游戏库 ================= */
  console.log('\n--- C. 游戏库 ---')
  await goto('/pages/games/games')
  const g0 = await count('.gitem')
  assert('C1 游戏列表渲染', g0 >= 10, `gitem=${g0}`)
  assert('C2 平台筛选条渲染', (await count('.chip')) >= 5)
  await page.screenshot({ path: path.join(SHOTS, 'C-games.png') })

  // 筛选 PC
  const chips = await page.$$('.chip')
  for (const c of chips) {
    const t = (await c.innerText()).trim()
    if (t === 'PC') {
      await c.click()
      break
    }
  }
  await sleep(2200)
  const gPc = await count('.gitem')
  assert('C3 选「PC」后列表刷新且数量变化', gPc > 0 && gPc !== g0, `before=${g0} after=${gPc}`)
  await page.screenshot({ path: path.join(SHOTS, 'C-games-pc.png') })

  // 上拉加载（current 自增）—— 单独用一次**干净导航**，避免与上面的筛选相互干扰
  // ⚠️ 实测：H5 的滚动容器是 documentElement/body（uni-page-body 自身不滚），
  //    滚到 `documentElement.scrollHeight` 才会触发 onReachBottom。
  await goto('/pages/games/games')
  const before = await count('.gitem')
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await sleep(1200)
  }
  const after = await count('.gitem')
  const sc = await page.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight }))
  assert('C4 上拉加载生效（current 参数正确）', after > before, `before=${before} after=${after} scrollY=${sc.y}/${sc.h}`)
  const footer = await text('.footer')
  assert('C5 底部状态文案存在', footer.length > 0, footer.replace(/\s+/g, ' '))

  /* ================= D. 资讯 ================= */
  console.log('\n--- D. 资讯 ---')
  await goto('/pages/news/news')
  assert('D1 资讯列表渲染', (await count('.pc')) >= 1, `pc=${await count('.pc')}`)
  assert('D2 排序 chip 渲染', (await count('.chip')) >= 4)
  await page.screenshot({ path: path.join(SHOTS, 'D-news.png') })

  /* ================= E. 我的 ================= */
  console.log('\n--- E. 我的 ---')
  await goto('/pages/my/my')
  assert('E1 账号区渲染', await count('.user') === 1)
  assert('E2 收藏/历史双 Tab', await count('.tabs__item') === 2)
  const myContent = await page.content()
  assert('E3 显示收藏或空态', myContent.includes('我的收藏'))
  await page.screenshot({ path: path.join(SHOTS, 'E-my.png') })

  /* ================= F. 搜索 ================= */
  console.log('\n--- F. 搜索 ---')
  await goto('/pages/search/search?keyword=' + encodeURIComponent('原神'))
  await sleep(1200)
  const searchContent = await page.content()
  assert('F1 搜索结果含关键词命中', searchContent.includes('原神'))
  assert('F2 类型 Tab 渲染', (await count('.tabs__item')) >= 3)
  await page.screenshot({ path: path.join(SHOTS, 'F-search.png') })

  /* ================= G. 全局 ================= */
  console.log('\n--- G. 全局 ---')
  assert('G1 tabBar 存在', (await count('uni-tabbar')) >= 1 || (await count('.uni-tabbar')) >= 1)
  const hardErrors = errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e))
  assert('G2 无 JS 运行时错误', hardErrors.length === 0, hardErrors.slice(0, 2).join(' | '))
  if (hardErrors.length) console.log('   错误明细：\n     ' + hardErrors.slice(0, 8).join('\n     '))

  await browser.close()
  console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
  console.log(`截图目录：${SHOTS}`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('脚本异常：', e.message)
  process.exit(1)
})

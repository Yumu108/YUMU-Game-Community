/**
 * 内容富化种子（030）验收：真实浏览器打开页面，确认新增数据「看得见、图能加载、不报错」。
 *
 * 覆盖：首页帖子列表封面 / 板块筛选 / 帖子详情（正文+回复+封面）/ 游戏列表封面 /
 *       用户主页（头像）/ 搜索 / 控制台零错误。
 *
 * 运行：cd tests/.pw && node verify-richseed.js
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'
const API = process.env.API_BASE || 'http://127.0.0.1:8080'

let pass = 0, fail = 0
const fails = []
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅', name, extra) }
  else { fail++; fails.push(name); console.log('  ❌', name, extra) }
}
const CARD = 'article.post'   // PostCard.vue 根元素（点击走 Vue 路由，不是 <a>）

;(async () => {
  // 先从接口挑出一篇「有回复、有封面」的帖子，用作详情页样本（避免硬编码 id）
  let sample = null
  try {
    const r = await fetch(`${API}/api/posts?size=50&sort=hot`).then((x) => x.json())
    sample = (r.data.records || []).find((x) => x.replyCount > 0 && x.cover) || r.data.records[0]
  } catch (e) { /* 留空，下面会判失败 */ }

  const b = await chromium.launch({ executablePath: EXE, headless: true })
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } })
  const errs = []
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)) })
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))

  async function seedImgStat() {
    return p.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img')).filter((i) => (i.src || '').includes('/api/files/seed_'))
      return {
        total: imgs.length,
        loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
        broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.split('/').pop()).slice(0, 5),
      }
    })
  }

  try {
    console.log('\n[0] 接口取样')
    ok('取到有回复+封面的样本帖', !!sample && sample.replyCount > 0 && !!sample.cover,
      sample ? `id=${sample.id} 回复${sample.replyCount} 赞${sample.likeCount} ${sample.cover}` : 'none')

    // ---------- 1. 首页 ----------
    console.log('\n[1] 首页')
    await p.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 40000 })
    await p.waitForTimeout(1500)
    const cardCount = await p.locator(CARD).count()
    ok('首页渲染出帖子卡片', cardCount >= 8, `(${cardCount} 张)`)
    let st = await seedImgStat()
    ok('首页种子封面加载完整（含懒加载容差）', st.total > 0 && st.loaded / st.total >= 0.9,
      `(${st.loaded}/${st.total}${st.broken.length ? ' 破损:' + st.broken.join(',') : ''})`)

    // ---------- 2. 板块页 ----------
    console.log('\n[2] 板块页')
    await p.goto(BASE + '/board/1', { waitUntil: 'networkidle', timeout: 40000 })
    await p.waitForTimeout(1500)
    const b1 = await p.locator(CARD).count()
    ok('攻略心得板块有内容', b1 >= 5, `(${b1} 张卡片)`)
    st = await seedImgStat()
    ok('板块页封面加载完整', st.total === 0 || st.loaded / st.total >= 0.9, `(${st.loaded}/${st.total})`)

    // ---------- 2b. 玩家天地（board 3，2026-09-17 由「组队大厅」更名） ----------
    console.log('\n[2b] 玩家天地')
    const boards = await fetch(`${API}/api/boards`).then((x) => x.json()).catch(() => null)
    const b3 = (boards?.data || []).find((x) => x.id === 3)
    ok('板块 3 已更名为「玩家天地」', !!b3 && b3.name === '玩家天地', b3 ? `name=${b3.name} icon=${b3.icon}` : 'not found')
    const b3r = await fetch(`${API}/api/posts?boardId=3&size=60`).then((x) => x.json()).catch(() => null)
    const recs3 = b3r?.data?.records || []
    ok('玩家天地有足量帖子', recs3.length >= 20, `(${recs3.length} 条)`)
    const t3 = recs3.map((r) => r.title).join(' ')
    ok('含「晒欧气 / 抽卡」类内容', /抽卡|欧气|十连|单抽|保底|开包|歪了|出了/.test(t3), '')
    ok('含「疑难求助 / 萌新提问」类内容', /求助|萌新|提问|求问|该练|卡关|怎么办/.test(t3), '')
    ok('仍保留「组队招募」类内容', /组队|招募|车队|开黑|求带/.test(t3), '')
    await p.goto(BASE + '/board/3', { waitUntil: 'networkidle', timeout: 40000 })
    await p.waitForTimeout(1800)
    const b3cards = await p.locator(CARD).count()
    ok('玩家天地板块页有内容', b3cards >= 5, `(${b3cards} 张卡片)`)
    const txt3 = await p.locator('body').innerText()
    ok('页面展示板块名「玩家天地」', txt3.includes('玩家天地'), '')
    ok('页面不再出现旧名「组队大厅」', !txt3.includes('组队大厅'), '')
    st = await seedImgStat()
    ok('玩家天地封面加载完整', st.total === 0 || st.loaded / st.total >= 0.9,
      `(${st.loaded}/${st.total}${st.broken.length ? ' 破损:' + st.broken.join(',') : ''})`)

    // ---------- 3. 帖子详情 ----------
    console.log('\n[3] 帖子详情')
    await p.goto(`${BASE}/post/${sample.id}`, { waitUntil: 'networkidle', timeout: 40000 })
    await p.waitForTimeout(1800)
    const bodyTxt = await p.locator('body').innerText()
    ok('详情页正常渲染', !/不存在|已删除/.test(bodyTxt.slice(0, 1500)))
    ok('详情页正文够长', bodyTxt.length > 500, `(页面文本 ${bodyTxt.length} 字)`)
    ok('发帖时间显示为相对时间', /(前|刚刚|昨天)/.test(bodyTxt), '')
    // 说明：详情页原设计不渲染封面（cover 只用于列表/卡片），所以这里改为校验标签数据落库可见
    ok('详情页显示帖子标签', /#[^\s#]{2,12}/.test(bodyTxt), '')
    const ava = await p.evaluate(() => {
      const i = document.querySelector('img[src*="/api/files/seed_ava_"]')
      return i ? { src: i.src.split('/').pop(), okk: i.complete && i.naturalWidth > 0 } : null
    })
    ok('作者头像已加载', !!ava && ava.okk, ava ? ava.src : 'not found')
    const replyTxt = await p.evaluate(() => {
      const nodes = document.querySelectorAll('[class*="reply"], [class*="Reply"]')
      return Array.from(nodes).map((n) => n.innerText).join(' ').length
    })
    ok('详情页有回复内容', replyTxt > 20, `(回复区文本 ${replyTxt} 字)`)

    // ---------- 4. 游戏页 ----------
    console.log('\n[4] 游戏库')
    await p.goto(BASE + '/games', { waitUntil: 'networkidle', timeout: 40000 })
    await p.waitForTimeout(1800)
    const gstat = await p.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img')).filter((i) => (i.src || '').includes('/api/files/seed_game_'))
      return { total: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length }
    })
    ok('游戏封面为种子图且已加载', gstat.total >= 8 && gstat.loaded / gstat.total >= 0.9,
      `(${gstat.loaded}/${gstat.total})`)

    // ---------- 5. 搜索 ----------
    console.log('\n[5] 搜索 / 标签')
    await p.goto(BASE + '/search?keyword=' + encodeURIComponent('原神'), { waitUntil: 'networkidle', timeout: 40000 })
    await p.waitForTimeout(1500)
    const sCount = await p.locator(CARD).count()
    ok('搜索「原神」有结果', sCount >= 1, `(${sCount} 条)`)

    // ---------- 6. 控制台 ----------
    console.log('\n[6] 控制台')
    const real = errs.filter((e) => !/favicon|ResizeObserver|Download the Vue|DevTools/.test(e))
    ok('无控制台错误', real.length === 0, real.length ? ':: ' + real.slice(0, 3).join(' | ') : '')
  } catch (e) {
    fail++
    fails.push('脚本异常')
    console.log('  ❌ 脚本异常:', String(e).slice(0, 300))
  }

  await b.close()
  console.log('\n' + '='.repeat(52))
  console.log(`结果：${pass} 通过 / ${fail} 失败`)
  if (fails.length) console.log('失败项：' + fails.join(' | '))
  console.log('='.repeat(52))
  process.exit(fail ? 1 : 0)
})()

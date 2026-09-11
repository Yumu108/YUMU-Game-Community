// 首页布局回归（9-11）
//   ① 「热门游戏」不再横向滑动：换行 + 整块居中 + 最多两行 + 末位固定「全部游戏」+ 长名省略
//   ② 主内容区不再出现横向滚动条：.picks 两列等宽、标题省略号真正生效
const { chromium } = require('playwright-core')
const fs = require('fs')
const path = require('path')

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP = process.env.WEB_BASE || 'http://localhost:5173'
const OUT = process.env.SHOT_DIR || 'E:/2kewai/YUMUGameCommunity/docs/screenshots'

let pass = 0, fail = 0
const section = (t) => console.log(`\n—— ${t} ——`)
function ok(cond, msg, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${msg}${extra ? '   ' + extra : ''}`) }
  else { fail++; console.log(`  ✗ ${msg}${extra ? '   ' + extra : ''}`) }
}

const measure = (page) => page.evaluate(() => {
  const box = (s) => document.querySelector(s)
  const cs = (s) => (box(s) ? getComputedStyle(box(s)) : null)
  const quick = box('.quick-scroll')
  const qRect = quick.getBoundingClientRect()
  const chips = [...quick.querySelectorAll('.quick-chip')].map((c) => {
    const r = c.getBoundingClientRect()
    const name = c.querySelector('.qc-name')
    return {
      name: name ? name.textContent.trim() : c.textContent.trim(),
      isGames: c.classList.contains('games'),
      top: Math.round(r.top),
      left: Math.round(r.left),
      right: Math.round(r.right),
      w: Math.round(r.width),
      nameClip: name ? name.scrollWidth > name.clientWidth + 1 : false,
      nameAnim: name ? getComputedStyle(name).textOverflow : ''
    }
  })
  const content = box('.content')
  const picks = box('.picks')
  return {
    vw: window.innerWidth,
    quick: {
      cw: quick.clientWidth, sw: quick.scrollWidth, ox: getComputedStyle(quick).overflowX,
      left: Math.round(qRect.left), right: Math.round(qRect.right),
      justify: getComputedStyle(quick).justifyContent, wrap: getComputedStyle(quick).flexWrap
    },
    chips,
    content: { cw: content.clientWidth, sw: content.scrollWidth },
    picks: { cw: picks.clientWidth, sw: picks.scrollWidth },
    picksCols: [...document.querySelectorAll('.picks-col')].map((n) => Math.round(n.getBoundingClientRect().width)),
    pickTitles: [...document.querySelectorAll('.pick-title')].map((t) => ({
      clip: t.scrollWidth > t.clientWidth + 1, te: getComputedStyle(t).textOverflow
    })),
    // 主内容区里任何越出右边界 1px 以上的后代（排除本该滚动的胶囊容器自身）
    bleeding: (() => {
      const cr = content.getBoundingClientRect()
      const out = []
      content.querySelectorAll('*').forEach((n) => {
        if (n.closest('.quick-scroll')) return
        const r = n.getBoundingClientRect()
        const dx = Math.round(r.right - cr.right)
        if (dx > 1) out.push(`${n.tagName.toLowerCase()}.${String(n.className).slice(0, 26)} +${dx}px`)
      })
      return out
    })()
  }
})

const rowsOf = (chips) => {
  const m = new Map()
  chips.forEach((c) => { if (!m.has(c.top)) m.set(c.top, []); m.get(c.top).push(c) })
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
}

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const errs = []
  let page = null

  const open = async (w) => {
    if (page) await page.close()
    page = await browser.newPage({ viewport: { width: w, height: 900 } })
    page.on('pageerror', (e) => errs.push(`${w}px → ${e.message}`))
    await page.goto(APP + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
    // 关掉公告弹窗，避免遮罩干扰量测
    await page.waitForSelector('.anno-modal', { timeout: 12000 }).catch(() => {})
    await page.evaluate(() => document.querySelector('.anno-modal')?.remove())
    await page.waitForSelector('.quick-chip', { timeout: 12000 }).catch(() => {})
    await page.waitForTimeout(900)
    return measure(page)
  }

  // ---------------------------------------------- 主视野（1440）
  let m = await open(1440)
  console.log(`[1440] 胶囊 ${m.chips.length} 个 | 容器 ${m.quick.cw}px | 内容 ${m.quick.sw}px`)
  m.chips.forEach((c, i) => console.log(`   #${i} ${c.name}  w=${c.w} top=${c.top}`))

  section('① 热门游戏：取消横滑')
  ok(!['auto', 'scroll'].includes(m.quick.ox), '容器 overflow-x 不再是 auto/scroll', `overflow-x: ${m.quick.ox}`)
  ok(m.quick.sw <= m.quick.cw + 1, '内容宽度未超出容器（无横向溢出）', `scrollW ${m.quick.sw} vs clientW ${m.quick.cw}`)
  ok(m.quick.wrap === 'wrap', 'flex-wrap 已开启', m.quick.wrap)

  section('① 热门游戏：换行 + 居中 + 两行封顶')
  const rows = rowsOf(m.chips)
  ok(rows.length === 2, '恰好铺成两行', `实际 ${rows.length} 行（${rows.map((r) => r.length).join('+')}）`)
  ok(m.chips.length === 8, '共 8 个胶囊（7 款游戏 + 全部游戏）', `实际 ${m.chips.length}`)
  ok(m.chips[m.chips.length - 1].isGames, '末位是「全部游戏」', m.chips[m.chips.length - 1].name)
  ok(m.quick.justify === 'center', '整块水平居中', m.quick.justify)
  rows.forEach((r, i) => {
    const gapL = r[0].left - m.quick.left
    const gapR = m.quick.right - r[r.length - 1].right
    ok(Math.abs(gapL - gapR) <= 2, `第 ${i + 1} 行左右留白对称（居中）`, `左 ${gapL}px / 右 ${gapR}px`)
  })

  section('① 热门游戏：长名省略')
  ok(m.chips.every((c) => c.nameAnim === 'ellipsis'), '每个游戏名都启用了 text-overflow: ellipsis')
  ok(m.chips.every((c) => c.w <= 200), '没有任何单个胶囊异常宽', `最宽 ${Math.max(...m.chips.map((c) => c.w))}px`)
  // 当前榜首都是 4 字短名，省略号不会自然触发 → 注入一个超长名，验证兜底规则真的生效
  const inj = await page.evaluate(() => {
    const n = document.querySelector('.quick-scroll .qc-name')
    if (!n) return null
    const old = n.textContent
    n.textContent = '崩坏：星穹铁道超长测试'
    const r = {
      sw: n.scrollWidth, cw: n.clientWidth,
      chipW: Math.round(n.closest('.quick-chip').getBoundingClientRect().width),
      overflows: n.scrollWidth > n.clientWidth + 1
    }
    n.textContent = old
    return r
  })
  ok(inj && inj.overflows, '超长游戏名被省略号收住（不再撑宽整行）',
    inj ? `文本 ${inj.sw}px / 可视 ${inj.cw}px，胶囊仍只有 ${inj.chipW}px` : '未取到元素')

  section('② 中间主区：不再出现横向滚动条')
  ok(m.content.sw <= m.content.cw + 1, '.content 无横向溢出', `scrollW ${m.content.sw} vs clientW ${m.content.cw}`)
  ok(m.picks.sw <= m.picks.cw + 1, '.picks 无横向溢出', `scrollW ${m.picks.sw} vs clientW ${m.picks.cw}`)
  ok(m.bleeding.length === 0, '没有元素越出主内容区右边界', m.bleeding.slice(0, 3).join(' | ') || '')

  section('② 每日精选 / 本周热门：恢复等宽 + 标题省略')
  ok(m.picksCols.length === 2 && Math.abs(m.picksCols[0] - m.picksCols[1]) <= 2,
    '两列恢复 1fr 1fr 等宽', `${m.picksCols.join(' / ')}px`)
  const pt = m.pickTitles.filter((t) => t.clip)
  ok(m.pickTitles.every((t) => t.te === 'ellipsis'), '标题均启用省略号')
  ok(pt.length >= 1, '过长标题被省略号截断', `${pt.length}/${m.pickTitles.length} 条溢出`)

  // ---------------------------------------------- 窄桌面回归
  section('多视口回归：窄桌面同样两行、同样无横滑')
  for (const w of [1366, 1280, 1200]) {
    const n = await open(w)
    const r = rowsOf(n.chips)
    ok(r.length === 2, `${w}px 下仍为两行`, `行分布 ${r.map((x) => x.length).join('+')} | 容器 ${n.quick.cw}px | 内容 ${n.quick.sw}px`)
    ok(n.quick.sw <= n.quick.cw + 1 && n.content.sw <= n.content.cw + 1,
      `${w}px 下无任何横向溢出`, `quick ${n.quick.sw}/${n.quick.cw} · content ${n.content.sw}/${n.content.cw}`)
    ok(Math.abs(n.picksCols[0] - n.picksCols[1]) <= 2, `${w}px 下两列仍等宽`, n.picksCols.join(' / '))
  }

  // ---------------------------------------------- 截图留档
  section('截图留档')
  await open(1440)
  const shots = [
    ['.quick', 'home-quick-games.png'],
    ['.picks', 'home-picks-cols.png']
  ]
  for (const [sel, name] of shots) {
    const p = path.join(OUT, name)
    await page.locator(sel).screenshot({ path: p }).catch((e) => console.log('   shot err', e.message))
    ok(fs.existsSync(p), `截图 ${name}`)
  }

  section('运行时错误')
  ok(errs.length === 0, '无常驻 pageerror', errs.slice(0, 2).join(' | ') || '')

  await browser.close()
  console.log(`\n================ ${pass} passed / ${fail} failed ================`)
  process.exit(fail ? 1 : 0)
})()

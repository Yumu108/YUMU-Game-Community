/**
 * 评审体检探针 —— 只测量、不改代码，一次性把「多视角」需要的事实变成数字。
 *
 * 用法：
 *   MP_BASE=http://8.133.255.202/m NODE_PATH="<repo>/tests/.pw/node_modules" \
 *     node tests/probe-review.cjs
 *
 * 覆盖：
 *   ① 响应式/宽屏      —— 桌面 1440px 下页面是否被拉伸（H5 是主交付渠道）
 *   ② 首屏体积/性能    —— 各资源传输字节、图片总量、DOM 节点数
 *   ③ 可访问性         —— 图片 alt 缺失、触控目标 < 44px、对比度
 *   ④ 导航可达性       —— tabBar 之外的页面怎么进（板块粒度）
 */
const path = require('path')
const { chromium } = require('playwright-core')

const EXE = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.MP_BASE || 'http://localhost:5199/m'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  /** 收集本次导航的全部资源传输字节 */
  const transfers = []
  page.on('response', async (res) => {
    try {
      const req = res.request()
      const url = res.url()
      if (!/\/api\/files\//.test(url) === false) return // 图片单独统计
      const h = await res.allHeaders()
      transfers.push({ url, type: req.resourceType(), len: Number(h['content-length'] || 0) })
    } catch (e) { /* ignore */ }
  })
  const imgStats = { count: 0, ok: 0, bytes: 0 }

  async function viewportProbe(w, h, label) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(BASE + '/#/pages/index/index', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(2500)
    const m = await page.evaluate(() => {
      const de = document.documentElement
      const pick = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { w: Math.round(r.width), x: Math.round(r.left) }
      }
      const txt = document.querySelector('.pc__title')
      return {
        vw: innerWidth,
        scrollW: de.scrollWidth,
        page: pick('.mp-page'),
        card: pick('.pc'),
        titleW: txt ? Math.round(txt.getBoundingClientRect().width) : null,
        cardCount: document.querySelectorAll('.pc').length,
        domNodes: de.querySelectorAll('*').length
      }
    })
    console.log(`\n--- ${label} (${w}×${h}) ---`)
    console.log(`  视口 ${m.vw} / 文档 scrollWidth ${m.scrollW}${m.scrollW > m.vw ? '  ⚠️ 横向溢出' : ''}`)
    console.log(`  .mp-page 宽 ${m.page && m.page.w}（x=${m.page && m.page.x}）`)
    console.log(`  帖子卡宽 ${m.card && m.card.w} / 标题可用宽 ${m.titleW}`)
    console.log(`  DOM 节点 ${m.domNodes}，帖子卡 ${m.cardCount} 张`)
    // ⚠️ 截图必须在这一档视口内拍，别等后面把尺寸改回去了再拍
    //    （踩过：文件名叫 R-desktop-1440 实际是 390 的图）
    await page.screenshot({ path: path.join(__dirname, 'shots', `R-${w}.png`) })
    return m
  }

  console.log('========== ① 响应式（H5 主交付渠道） ==========')
  const mobile = await viewportProbe(390, 844, '手机 390')
  const desk = await viewportProbe(1440, 900, '桌面 1440')
  const pad = await viewportProbe(768, 1024, '平板 768')

  console.log('\n  拉伸比：桌面卡宽 / 手机卡宽 = ' +
    (desk.card && mobile.card ? (desk.card.w / mobile.card.w).toFixed(2) + '×' : 'n/a'))

  console.log('\n========== ② 首屏体积 ==========')
  await page.setViewportSize({ width: 390, height: 844 })
  const t0 = Date.now()
  await page.goto(BASE + '/#/pages/index/index', { waitUntil: 'networkidle' }).catch(() => {})
  const elapsed = Date.now() - t0
  await sleep(1200)

  const res = await page.evaluate(() => {
    const out = []
    performance.getEntriesByType('resource').forEach((r) => {
      out.push({ name: r.name, type: r.initiatorType, size: r.transferSize || 0, dur: Math.round(r.duration) })
    })
    const nav = performance.getEntriesByType('navigation')[0] || {}
    return { out, domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0), out2: out.length !== 0 }
  })
  const js = res.out.filter((r) => /\.js(\?|$)/.test(r.name))
  const css = res.out.filter((r) => /\.css(\?|$)/.test(r.name))
  const img = res.out.filter((r) => /\/api\/files\//.test(r.name))
  const sum = (a) => a.reduce((s, x) => s + x.size, 0)
  const kb = (n) => (n / 1024).toFixed(1) + ' KB'
  console.log(`  首屏耗时（networkidle）≈ ${elapsed} ms，DOMContentLoaded ${res.domContentLoaded} ms`)
  console.log(`  JS  ${js.length} 个 / ${kb(sum(js))}`)
  console.log(`  CSS ${css.length} 个 / ${kb(sum(css))}`)
  console.log(`  图片 ${img.length} 个 / ${kb(sum(img))}  ← 首屏就拉这么多图`)
  console.log(`  其它 ${res.out.length - js.length - css.length - img.length} 个 / ${kb(sum(res.out) - sum(js) - sum(css) - sum(img))}`)
  console.log(`  首屏合计 ≈ ${kb(sum(res.out))}`)
  console.log('  最重的 5 个：')
  res.out.sort((a, b) => b.size - a.size).slice(0, 5)
    .forEach((r) => console.log(`    ${kb(r.size).padStart(9)}  ${r.name.replace(BASE, '').slice(0, 70)}`))

  console.log('\n========== ③ 可访问性 ==========')
  const a11y = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img, uni-image'))
    const noAlt = imgs.filter((el) => {
      if (el.tagName === 'IMG') return !el.getAttribute('alt')
      // uni-image 内部才是真 img
      const inner = el.querySelector('img')
      return inner ? !inner.getAttribute('alt') : true
    }).length
    const imgs2 = Array.from(document.querySelectorAll('img'))
    const noAltReal = imgs2.filter((el) => !el.getAttribute('alt')).length
    // 触控目标
    const tappable = Array.from(document.querySelectorAll('.pc, .gcard, .chip, .tabs__item, .btn, .fab__btn, .item'))
    const small = tappable.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.height > 0 && r.height < 44
    }).map((el) => ({ cls: el.className, h: Math.round(el.getBoundingClientRect().height) }))
    // 对比度：取几个文字元素的前景/背景
    const lum = (c) => {
      const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const parse = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number)
    const ratio = (fg, bg) => {
      const L1 = lum(parse(fg)), L2 = lum(parse(bg))
      const a = Math.max(L1, L2), b = Math.min(L1, L2)
      return +(((a + 0.05) / (b + 0.05)).toFixed(2))
    }
    const sample = (sel, bgSel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      const bgEl = bgSel ? document.querySelector(bgSel) : el.parentElement
      const bg = bgEl ? getComputedStyle(bgEl).backgroundColor : '#000'
      return { sel, size: cs.fontSize, fg: cs.color, bg: bg === 'rgba(0, 0, 0, 0)' ? '#0f0d16' : bg, ratio: ratio(cs.color, bg === 'rgba(0, 0, 0, 0)' ? '#0f0d16' : bg) }
    }
    return {
      imgTotal: imgs.length,
      imgNoAlt: noAlt,
      imgNoAltReal: noAltReal,
      smallTargets: small.slice(0, 8),
      smallCount: small.length,
      contrast: [
        sample('.pc__title', '.pc'),
        sample('.pc__meta', '.pc'),
        sample('.pc__summary', '.pc'),
        sample('.gcard__meta', '.gcard')
      ].filter(Boolean)
    }
  })
  console.log(`  <image> 元素 ${a11y.imgTotal} 个，其中无 alt ${a11y.imgNoAlt} 个（真 <img> 无 alt ${a11y.imgNoAltReal} 个）`)
  console.log(`  触控目标高度 <44px 的：${a11y.smallCount} 个`)
  a11y.smallTargets.forEach((s) => console.log(`    ${s.h}px  ${s.cls}`))
  console.log('  文字对比度（WCAG AA 正文需 ≥4.5，大字 ≥3.0）：')
  a11y.contrast.forEach((c) => console.log(`    ${c.ratio}:1  ${c.size}  fg=${c.fg}  ${c.sel}`))

  console.log('\n========== ④ 导航可达性 ==========')
  const nav = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('uni-tabbar .uni-tabbar__label, .uni-tabbar__label'))
      .map((e) => e.textContent.trim()).filter(Boolean)
    return { tabLabels: tabs, hasBoardNav: !!document.querySelector('[data-board]') }
  })
  console.log(`  tabBar：${nav.tabLabels.join(' / ') || '(未取到)'}`)
  console.log('  页面内是否有板块级导航（board 切换）：' + (nav.hasBoardNav ? '有' : '无'))

  await browser.close()
  console.log('\n截图：tests/shots/R-390.png / R-768.png / R-1440.png（各自在对应视口内拍摄）')
})().catch((e) => { console.error('探针失败：', e.message); process.exit(1) })

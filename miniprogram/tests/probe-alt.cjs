/**
 * 探针：图片的**可读名**到底落在哪一层，以及谁真的缺。
 *
 * ── 为什么需要这个（2026-09-17 实测踩到）─────────────────────────
 * `PostCard.vue` 里给 `<image>` 写了 `:alt`，看起来「无障碍做完了」。
 * 一实测：页面里 **16 个真实 `<img>`，0 个带 `alt` 属性** —— 内容封面全都没有。
 * 原因是 **uni-app H5 的 `<image>` 不会把 `alt` 透传给内部 `<img>`**
 * （`alt` 是小程序端原生组件的属性，H5 下被直接丢弃）。
 * 所以「补 alt」在 H5 是**无效动作**，真正要改的是 `<uni-image>` 自定义元素的
 * `role="img"` + `aria-label`。两端各给一份，不是冗余，是两个运行时的差异。
 *
 * ⚠️ 因此本探针的**判据放在 `<uni-image>` 包装层**，内层 `<img>` 只作对照：
 *    内层 `alt=null` 在 H5 下是**恒定的**，不是缺陷 —— 拿它当判据只会让人白改。
 *
 * 运行：node tests/probe-alt.cjs [路由] [视口宽]
 *   node tests/probe-alt.cjs                          # 首页 390
 *   node tests/probe-alt.cjs /pages/games/games 1440
 *   node tests/probe-alt.cjs /pages/post/detail?id=200041
 */
const { chromium } = require('playwright-core')

const EXE = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.MP_BASE || 'http://localhost:5199/m'
const ROUTE = process.argv[2] || '/pages/index/index'
const W = Number(process.argv[3] || 390)

/** tabBar 图标属装饰图（旁边就有文字标签），天然允许没有可读名 */
const isDecorative = (cls) => /tabbar/i.test(cls)

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const page = await (
    await browser.newContext({ viewport: { width: W, height: 900 } })
  ).newPage()
  await page.goto(`${BASE}/#${ROUTE}`, { waitUntil: 'networkidle' })
  await new Promise((r) => setTimeout(r, 2500))

  const data = await page.evaluate(() => {
    const wrappers = Array.from(document.querySelectorAll('uni-image')).map((el) => {
      const img = el.querySelector('img')
      return {
        cls: String(el.className || '').split(' ').slice(0, 2).join(' '),
        role: el.getAttribute('role'),
        aria: el.getAttribute('aria-label'),
        alt: el.getAttribute('alt'),
        innerAlt: img ? img.getAttribute('alt') : '(无内层 img)',
        src: ((img && img.getAttribute('src')) || '').slice(0, 70)
      }
    })
    const tabImgs = Array.from(document.querySelectorAll('uni-tabbar img')).map((i) => ({
      src: (i.getAttribute('src') || '').slice(0, 70),
      alt: i.getAttribute('alt')
    }))
    return { wrappers, tabImgs }
  })

  console.log(`路由 ${ROUTE}  视口 ${W}px\n`)
  console.log('========== ① 判据层：<uni-image> 包装层的可读名 ==========')
  const content = data.wrappers.filter((w) => !isDecorative(w.cls))
  const bad = content.filter((w) => !w.aria)
  content.forEach((w, i) => {
    const mark = w.aria ? '✅' : '⚠️'
    console.log(
      `  ${mark} ${i + 1}. ${w.cls}  role=${w.role || '(无)'}  aria-label=${JSON.stringify(w.aria)}`
    )
    console.log(`        src=${w.src}   内层 img alt=${JSON.stringify(w.innerAlt)}`)
  })
  if (!content.length) console.log('  （本页没有 uni-image）')
  console.log(
    `  → 内容图 ${content.length} 个，缺可读名 ${bad.length} 个` +
      (bad.length ? ' ← **这才是要修的**' : '（全部有可读名）')
  )

  console.log('\n========== ② 对照层：内层 <img> 的 alt（H5 下恒为空，不是缺陷）==========')
  const innerNoAlt = content.filter((w) => !w.innerAlt).length
  console.log(
    `  内容图内层 <img> 带 alt 的：${content.length - innerNoAlt} / ${content.length}` +
      `　⇒ ${innerNoAlt === content.length ? '全部为空 —— 与「uni-app H5 丢弃 alt」的实测结论一致' : '有部分带 alt，说明 uni-app 行为变了，回来复核这条结论'}`
  )

  console.log('\n========== ③ tabBar 图标（装饰图，允许无 alt）==========')
  data.tabImgs.forEach((t, i) => console.log(`  ${i + 1}. alt=${JSON.stringify(t.alt)}  ${t.src}`))

  console.log('\n判据一句话：**看 ① 的 `aria-label`，别看 ② 的 `alt`**。')
  console.log('  ② 恒空是 H5 的既定行为；① 缺了才是真的对读屏用户不友好。')
  await browser.close()
})().catch((e) => {
  console.error('探针异常：', e.message)
  process.exit(1)
})

/**
 * 诊断探针：帖子回复区为什么没显示？
 *
 * 运行：
 *   cd miniprogram
 *   npm run build:h5 && node tests/serve-h5.mjs &
 *   NODE_PATH="<repo>/tests/.pw/node_modules" node tests/probe-reply.cjs
 *
 * 可配环境变量：MP_BASE（默认 http://localhost:5199/m）、POST_ID（默认动态取回复最多的帖子）
 *
 * 它同时打印**两边的真相**，这正是 2026-09-17 那类问题的定位关键：
 *   ① 接口到底返回什么形状（`data` 是裸数组还是分页体？有多少条？）
 *   ② 页面把这些数据渲染成了什么（多少条 DOM、有没有掉进空态）
 * 「接口有 27 条、页面说 0 条」这种矛盾一眼就能看出来；
 * 而只看 DOM 是发现不了的 —— 页面显示的是完全正常的「还没有回复」空态。
 */
const { chromium } = require('playwright-core')

const EXE = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.MP_BASE || 'http://localhost:5199/m'
/** 取数要走**站点根**，不能带 `/m` 前缀（那是 H5 的路由 base，`/m/api/**` 是 404） */
const ORIGIN = BASE.replace(/\/m\/?$/, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
    const b = await chromium.launch({ executablePath: EXE, headless: true })
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
    const p = await ctx.newPage()

    const repliesReqs = []
    p.on('response', async (r) => {
        if (!r.url().includes('/replies')) return
        let shape = 'parse-fail'
        try {
            const j = await r.json()
            shape = Array.isArray(j.data)
                ? `裸数组(${j.data.length} 条)`
                : j.data && typeof j.data === 'object'
                  ? `对象{${Object.keys(j.data).join(',')}}`
                  : String(j.data)
        } catch (e) {
            /* 保持 parse-fail */
        }
        repliesReqs.push({ url: r.url().replace(/^https?:\/\/[^/]+/, ''), status: r.status(), shape })
    })

    // 未指定 POST_ID 时动态取「回复最多」的帖子（硬编码 id 会因库不同而假失败）
    let id = process.env.POST_ID
    if (!id) {
        const r = await fetch(`${ORIGIN}/api/posts?sort=reply&current=1&size=1`).then((x) => x.json())
        id = r.data.records[0].id
    }

    await p.goto(`${BASE}/?t=${Date.now()}#/pages/post/detail?id=${id}`, { waitUntil: 'domcontentloaded' })
    await sleep(3600)

    const out = await p.evaluate(() => {
        const secs = Array.from(document.querySelectorAll('.mp-sec__title')).map((e) => e.innerText.trim())
        return {
            replyHeading: secs[0] || '(未找到)',
            domCount: document.querySelectorAll('.reply').length,
            floorCount: document.querySelectorAll('.reply__floor').length,
            nestedCount: document.querySelectorAll('.reply__to').length,
            moreText: (document.querySelector('.more') || {}).innerText || '',
            saysEmpty: (document.body.innerText || '').includes('还没有回复'),
            stepCards: document.querySelectorAll('.step').length,
            sectCount: document.querySelectorAll('.sect').length,
            introCount: document.querySelectorAll('.intro').length
        }
    })

    console.log(`帖子 id        : ${id}`)
    console.log(`拆解卡 / 分组 / 导语 : ${out.stepCards} / ${out.sectCount} / ${out.introCount}`)
    console.log(`回复标题        : ${out.replyHeading}`)
    console.log(`回复 DOM 条数   : ${out.domCount}`)
    console.log(`楼层号 / 楼中楼 : ${out.floorCount} / ${out.nestedCount}`)
    console.log(`展开按钮        : ${out.moreText || '(无)'}`)
    console.log(`页面是否说「还没有回复」: ${out.saysEmpty ? '是 ⚠️' : '否'}`)
    console.log('\n回复接口的实际响应：')
    repliesReqs.forEach((x) => console.log(`  ${x.status}  data=${x.shape}  ${x.url}`))
    if (!repliesReqs.length) console.log('  ⚠️ 没有捕获到 /replies 请求 —— 前端根本没发？')

    await p.screenshot({ path: 'tests/shots/probe-reply.png', fullPage: false })
    await b.close()
})()

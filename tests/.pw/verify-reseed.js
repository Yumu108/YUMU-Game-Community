// 用法：node verify-reseed.js
// 作用：演示数据重整后的 UI 层验收 —— 逐页确认"社区看起来饱满"且没有破图/报错。
// 覆盖：首页 / 板块页 / 游戏库 / 游戏专区 / 帖子详情（含楼中楼）/ 用户主页 / 公告页
// 依赖：前端 5173（preview 产物或 dev server 均可）+ 后端 8080
const { chromium } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP = process.env.WEB_BASE || 'http://localhost:5173'
const OUT = path.resolve(__dirname, '../../docs/screenshots')

let pass = 0, fail = 0
const failures = []
function ok (cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`) }
}
function section (t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`) }

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const page = await ctx.newPage()

  const errors = []
  page.on('pageerror', e => errors.push('PAGEERR ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()) })

  // 首次进首页会弹公告弹窗，铺满全屏会拦截所有点击 —— 先关掉
  async function dismissAnno () {
    for (let i = 0; i < 3; i++) {
      const m = await page.$('.anno-modal')
      if (!m) return
      const btn = await page.$('.anno-modal .anno-close')
      if (btn) await btn.click().catch(() => {})
      await page.waitForTimeout(400)
    }
  }
  async function go (url, wait = 2200) {
    await page.goto(APP + url, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(wait)
    await dismissAnno()
  }
  // 统计破图：<img> 已加载完但 naturalWidth=0
  const brokenImgs = () => page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .filter(i => i.complete && i.naturalWidth === 0)
      .map(i => i.getAttribute('src')).slice(0, 8))

  console.log('═'.repeat(66))
  console.log(' YUMU 演示数据重整 —— UI 验收')
  console.log(' 目标：', APP)
  console.log('═'.repeat(66))

  // ---------------------------------------------------------- 首页
  section('首页')
  await go('/')
  const home = await page.evaluate(() => ({
    title: document.querySelector('.section-title')?.textContent?.trim() || '',
    cards: document.querySelectorAll('.post').length,
    coverCards: document.querySelectorAll('.post img').length,
    quickCounts: [...document.querySelectorAll('.qc-count')].map(e => e.textContent.trim()),
    boardNames: [...document.querySelectorAll('.qc-name')].map(e => e.textContent.trim())
  }))
  ok(home.cards >= 8, '首页渲染出帖子卡片', `${home.cards} 张`)
  ok(home.quickCounts.length >= 6, '首页板块快捷入口 ≥ 6 个', `${home.quickCounts.length} 个`)
  ok(home.quickCounts.every(c => Number(c.replace(/\D/g, '')) > 0), '每个板块计数均 > 0（无空板块）', home.quickCounts.join('/'))
  const homeBroken = await brokenImgs()
  ok(homeBroken.length === 0, '首页无破图', homeBroken.join(', '))
  await page.screenshot({ path: path.join(OUT, 'reseed-home.png'), fullPage: true })
  console.log('     → docs/screenshots/reseed-home.png')

  // ---------------------------------------------------------- 板块页
  section('板块页')
  await go('/board/1')
  const board = await page.evaluate(() => ({
    cards: document.querySelectorAll('.post').length,
    pagers: document.querySelectorAll('.el-pager li').length,
    firstTitle: document.querySelector('.post .p-title')?.textContent?.trim() || ''
  }))
  ok(board.cards >= 8, '板块页渲染帖子卡片', `${board.cards} 张`)
  ok(board.pagers >= 3, '出现分页条（帖子量足以翻页）', `${board.pagers} 个页码`)
  ok(!!board.firstTitle, '帖子有标题', board.firstTitle.slice(0, 24))
  await page.screenshot({ path: path.join(OUT, 'reseed-board.png'), fullPage: true })
  console.log('     → docs/screenshots/reseed-board.png')

  // ---------------------------------------------------------- 游戏库
  section('游戏库 / 游戏专区')
  await go('/games')
  const games = await page.evaluate(() => ({
    cards: document.querySelectorAll('.game-card, .g-card').length,
    counts: [...document.querySelectorAll('.g-count, .game-count')].map(e => e.textContent.trim()).filter(Boolean)
  }))
  ok(games.cards > 0 || games.counts.length > 0, '游戏库页有游戏', `卡片 ${games.cards}`)
  await page.screenshot({ path: path.join(OUT, 'reseed-games.png'), fullPage: true })
  console.log('     → docs/screenshots/reseed-games.png')

  await go('/game/2')
  const gd = await page.evaluate(() => ({
    statVals: [...document.querySelectorAll('.stat-val')].map(e => e.textContent.trim()),
    bodyText: document.body.innerText.slice(0, 4000)
  }))
  ok(gd.statVals.some(v => Number(v.replace(/\D/g, '')) > 0), '游戏专区帖数统计非 0', gd.statVals.join('/'))
  ok(/版主|活跃/.test(gd.bodyText), '游戏专区显示版主/活跃玩家')
  const gdBroken = await brokenImgs()
  ok(gdBroken.length === 0, '游戏专区无破图')
  await page.screenshot({ path: path.join(OUT, 'reseed-game-detail.png'), fullPage: true })
  console.log('     → docs/screenshots/reseed-game-detail.png')

  // ---------------------------------------------------------- 帖子详情
  section('帖子详情 / 楼中楼')
  // 取一篇回复多的帖子
  const top = await fetch('http://localhost:8080/api/posts?sort=reply&current=1&size=1')
    .then(r => r.json()).then(j => j.data.records[0]).catch(() => null)
  ok(!!top, '取到回复最多的帖子用于详情页校验', top ? `#${top.id} ${top.replyCount} 条回复` : '')
  if (top) {
    await go(`/post/${top.id}`)
    const detail = await page.evaluate(() => ({
      titleShown: !!document.querySelector('.d-title, h1'),
      mains: document.querySelectorAll('.main-reply').length,
      subs: document.querySelectorAll('.sub-reply').length,
      actions: !!document.querySelector('.d-actions'),
      avatarOk: (() => {
        const a = document.querySelector('.d-ava img')
        return a ? (a.complete && a.naturalWidth > 0) : null
      })()
    }))
    ok(detail.mains > 0, '详情页渲染出一级回复', `${detail.mains} 条`)
    ok(detail.subs > 0, '详情页渲染出楼中楼子回复', `${detail.subs} 条`)
    ok(detail.actions, '可见帖显示点赞/收藏/举报操作区')
    ok(detail.avatarOk !== false, '作者头像加载成功', String(detail.avatarOk))
    const dBroke = await brokenImgs()
    ok(dBroke.length === 0, '详情页无破图', dBroke.join(', '))
    await page.screenshot({ path: path.join(OUT, 'reseed-post-detail.png'), fullPage: true })
    console.log('     → docs/screenshots/reseed-post-detail.png')
  }

  // ---------------------------------------------------------- 用户主页
  section('用户主页 / 公告')
  await go('/user/1001')
  const prof = await page.evaluate(() => {
    const img = document.querySelector('.u-avatar img, img')
    return {
      nickname: document.body.innerText.split('\n').map(s => s.trim()).filter(Boolean)[1] || '',
      avatarOk: img ? (img.complete && img.naturalWidth > 0) : null,
      avatarSrc: img ? img.getAttribute('src') : '',
      text: document.body.innerText.slice(0, 1200)
    }
  })
  ok(prof.avatarOk === true, '新玩家 SVG 头像真实解码成功', prof.avatarSrc)
  ok(/帖|粉丝|关注/.test(prof.text), '用户主页显示统计信息')
  await page.screenshot({ path: path.join(OUT, 'reseed-user.png'), fullPage: true })
  console.log('     → docs/screenshots/reseed-user.png')

  await go('/announcements')
  const annText = await page.evaluate(() => document.body.innerText)
  ok(/公告|规范|欢迎/.test(annText) && annText.length > 200, '公告页有内容（公告未全被隐藏）')
  await page.screenshot({ path: path.join(OUT, 'reseed-announcements.png'), fullPage: true })
  console.log('     → docs/screenshots/reseed-announcements.png')

  // ---------------------------------------------------------- 控制台
  section('控制台')
  const hard = errors.filter(e => /Failed to resolve component|Failed to resolve directive|PAGEERR/.test(e))
  ok(hard.length === 0, '无致命控制台错误（未注册组件/指令/运行时异常）', hard.slice(0, 3).join(' | '))
  if (errors.length) {
    console.log(`     ℹ️ 共 ${errors.length} 条 console 记录（含既有告警），前 3 条：`)
    errors.slice(0, 3).forEach(e => console.log('       - ' + e.slice(0, 140)))
  }

  await browser.close()
  console.log('\n' + '═'.repeat(66))
  console.log(` === 结果：${pass}/${pass + fail} 通过 ===`)
  if (failures.length) failures.forEach(f => console.log('   失败：' + f))
  console.log('═'.repeat(66))
  process.exit(fail === 0 ? 0 : 1)
})().catch(e => { console.error('FATAL', e); process.exit(1) })

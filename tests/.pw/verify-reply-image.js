/**
 * 回复发图 —— 浏览器级验证（playwright-core + 系统 Chrome）
 * 前置：dev server 跑在 localhost:5173，后端 8080
 * 运行：cd tests/.pw && node verify-reply-image.js
 *
 * 验证：回复框的 RichEditor 能插入图片 → 发送 → 列表中渲染出 <img>
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const API = 'http://127.0.0.1:8080/api'
const POST_ID = 3019

// 造一张可见的 600x400 24 位 BMP（后端会转成 JPG 落盘，截图里能直观看到图）
function makeBmp(width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const dataSize = rowSize * height
  const fileSize = 54 + dataSize
  const buf = Buffer.alloc(fileSize)
  buf.write('BM', 0, 'ascii')
  buf.writeUInt32LE(fileSize, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(width, 18)
  buf.writeInt32LE(height, 22)
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(0, 30)
  buf.writeUInt32LE(dataSize, 34)
  buf.writeInt32LE(2835, 38)
  buf.writeInt32LE(2835, 42)
  let p = 54
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      buf[p++] = (x * 255 / width) | 0
      buf[p++] = (y * 255 / height) | 0
      buf[p++] = ((x + y) * 255 / (width + height)) | 0
    }
    p += rowSize - width * 3
  }
  return buf
}
const SHOT = { name: 'shot.bmp', mimeType: 'image/bmp', buffer: makeBmp(600, 400) }

async function apiGet(path, token) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } })
  return r.json()
}
async function apiDel(path, token) {
  const r = await fetch(API + path, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  return r.json()
}

;(async () => {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') })
  }).then((r) => r.json())
  const token = login.data.token

  const before = (await apiGet(`/posts/${POST_ID}/replies`, token)).data || []
  const beforeIds = new Set(before.map((r) => r.id))

  const b = await chromium.launch({ executablePath: EXE, headless: true })
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await c.addInitScript(
    ([t, u]) => {
      if (!localStorage.getItem('token')) {
        localStorage.setItem('token', t)
        localStorage.setItem('userInfo', u)
      }
    },
    [token, JSON.stringify(login.data.user)]
  )
  const p = await c.newPage()
  const errs = []
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))

  await p.goto(`http://localhost:5173/post/${POST_ID}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(2500)

  // 首页/详情页冷启动可能有公告弹窗遮挡
  const annoClose = await p.$('.anno-close')
  if (annoClose) { await annoClose.click().catch(() => {}) ; await p.waitForTimeout(400) }

  const checks = []
  const check = (n, ok, extra = '') => { checks.push([n, ok, extra]); }

  // 回复框存在？
  const replyBox = await p.$('.reply-box')
  check('回复框存在', !!replyBox)

  // 图片按钮存在？
  const hasImgBtn = replyBox ? await replyBox.$('.re-btn') : null
  const imgBtnText = hasImgBtn ? (await hasImgBtn.innerText()).trim() : ''
  check('回复框编辑器有「图片」按钮', /图片/.test(imgBtnText), imgBtnText)

  // 隐藏 file input 存在？
  const fileInput = await p.$('.reply-box input[type=file]')
  check('回复框存在 file input', !!fileInput)

  // 真实走一次：选文件 → 上传 → 插入 markdown
  if (fileInput) {
    await fileInput.setInputFiles(SHOT)
    // 等上传 + 插入
    let md = ''
    for (let i = 0; i < 40; i++) {
      await p.waitForTimeout(250)
      md = await p.$eval('.reply-box textarea', (el) => el.value).catch(() => '')
      if (/!\[图片\]\(\/api\/files\/.+\)/.test(md)) break
    }
    check('插入图片后编辑器出现图片标记', /!\[图片\]\(\/api\/files\/.+\)/.test(md), md.slice(0, 70))
  }

  // 点发送
  const sendBtn = await p.$('.reply-box .rb-actions .el-button--primary')
  check('发送按钮存在', !!sendBtn)
  if (sendBtn) {
    await sendBtn.click()
    await p.waitForTimeout(2500)
  }

  // 列表是否渲染出 <img>
  const imgInfo = await p.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('.mr-content img, .sr-content img'))
    return imgs.map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth }))
  })
  const uploaded = imgInfo.filter((i) => String(i.src).startsWith('/api/files/'))
  check('回复列表渲染出图片 <img>', uploaded.length > 0, `${imgInfo.length} 张，其中上传图 ${uploaded.length} 张`)
  check('图片实际加载成功（naturalWidth>0）', uploaded.some((i) => i.w > 0),
    uploaded.map((i) => `${i.src}=${i.w}px`).join(', '))

  check('无控制台错误', errs.filter((e) => !/favicon/.test(e)).length === 0, errs.slice(0, 2).join(' | '))

  await p.screenshot({ path: 'reply-image.png', fullPage: false })

  // 清理新增回复
  const after = (await apiGet(`/posts/${POST_ID}/replies`, token)).data || []
  let cleaned = 0
  for (const r of after) {
    if (!beforeIds.has(r.id) && String(r.content || '').includes('/api/files/')) {
      const d = await apiDel(`/posts/replies/${r.id}`, token)
      if (d.code === 200) cleaned++
    }
  }
  check('测试回复已清理', cleaned > 0, `清理 ${cleaned} 条`)

  let pass = 0
  for (const [n, ok, extra] of checks) {
    console.log(`  ${ok ? '✅' : '❌'} ${n}${extra ? ' —— ' + extra : ''}`)
    if (ok) pass++
  }
  console.log(`\n=== 回复发图（浏览器）：${pass}/${checks.length} 通过 ===`)
  await b.close()
  process.exit(pass === checks.length ? 0 : 1)
})().catch((e) => { console.error(e.message); process.exit(1) })

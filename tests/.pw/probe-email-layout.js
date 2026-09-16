/**
 * 一次性截图探针：登录一个**已绑定邮箱**的账号，把设置页「邮箱换绑」区块截下来，
 * 用于人工核对「新邮箱独占整行 + 发码按钮在验证码行」的视觉效果。
 *
 * 用法：node probe-email-layout.js          （默认用 8081 冒烟脚本造出来的 mymail_ 测试账号）
 *      U=<账号> P=<密码> node probe-email-layout.js
 * 前置：5173（Vite dev）在跑；后端在 8080 或 8081 均可（登录不发信）。
 */
const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.WEB_BASE || 'http://localhost:5173'
const U = process.env.U || 'mymail_3gkkap'
const P = process.env.P || 'pass123456'

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1200)
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1200)
  const ins = page.locator('.login-card .el-input__inner')
  await ins.nth(0).fill(U)
  await ins.nth(1).fill(P)
  await page.click('.submit')
  await page.waitForTimeout(2500)
  const ok = await page.evaluate(() => !!localStorage.getItem('token'))
  if (!ok) { console.log('登录失败：账号/密码不对，或后端没在跑'); await browser.close(); process.exit(1) }
  await page.goto(BASE + '/my', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1800)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tabs button')].find((x) => /账号设置/.test(x.textContent))
    if (b) b.click()
  })
  await page.waitForTimeout(1200)
  const block = page.locator('.set-form').filter({ hasText: /邮箱换绑|绑定邮箱/ }).first()
  await block.screenshot({ path: 'email-block-after.png' })
  await page.screenshot({ path: 'settings-after.png' })
  console.log('已截图：email-block-after.png / settings-after.png')
  await browser.close()
})()

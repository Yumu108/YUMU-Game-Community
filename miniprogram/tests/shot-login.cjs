/**
 * 登录页视觉冒烟：截「登录态 / 注册态（含协议勾选）/ 忘记密码态」三张图（tests/shots/L-login*.png）。
 * 用法：NODE_PATH=<repo>/tests/.pw/node_modules node tests/shot-login.cjs
 */
const { chromium } = require('playwright-core')
const path = require('path')

const BASE = process.env.MP_BASE || 'http://localhost:5199/m'

;(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  })
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  await page.goto(BASE + '/#/pages/login/login', { waitUntil: 'networkidle' })
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: path.join(__dirname, 'shots', 'L-login.png') })
  await page.click('.seg__item:nth-child(2)')
  await new Promise((r) => setTimeout(r, 500))
  await page.screenshot({ path: path.join(__dirname, 'shots', 'L-login-register.png') })
  // 忘记密码视图（独立视图，无 Tab；入口只在登录态）
  // ⚠️ hash 相同时 goto 不会重新挂载页面 —— 上一态是注册，直接点回登录 Tab 即可。
  await page.click('.seg__item:nth-child(1)')
  await new Promise((r) => setTimeout(r, 500))
  await page.click('.forgot-row__link')
  await new Promise((r) => setTimeout(r, 500))
  await page.screenshot({ path: path.join(__dirname, 'shots', 'L-login-forgot.png') })
  console.log('截图完成：tests/shots/L-login.png / L-login-register.png / L-login-forgot.png')
  await browser.close()
})()

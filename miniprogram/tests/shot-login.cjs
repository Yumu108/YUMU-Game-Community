/**
 * 登录页视觉冒烟：截「登录态」与「注册态」两张图（tests/shots/L-login*.png）。
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
  console.log('截图完成：tests/shots/L-login.png / L-login-register.png')
  await browser.close()
})()

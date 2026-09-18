/**
 * 微信小程序 AppID 注入 / 还原（2026-09-18 新增）
 *
 * 背景：AppID 曾硬编码在 `src/manifest.json` 里被 GitHub 密钥扫描告警，
 *       2026-09-18 已用 git filter-repo 从全部历史清除。现在仓库里
 *       manifest.json 永远是 `"appid": ""`，真实 AppID 只存在本机
 *       `.env.local`（已被 .gitignore 覆盖，绝不提交）。
 *
 * 用法（在 miniprogram/ 目录下）：
 *   npm run appid:inject    # 把 .env.local 的 WX_APPID 写进 manifest.json（本机开发/构建用）
 *   npm run appid:restore   # 还原为 ""（⚠️ 提交 / 发版前必须先 restore，否则工作区脏会被拒发）
 *
 * 实现说明：不 JSON.parse 整个文件（uni manifest 允许注释，未来加了就会炸），
 *           而是**只定位 "mp-weixin" 块里的第一个 "appid"** —— 顶层 appid 是
 *           HBuilderX 的应用 id，别动它。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const manifestPath = join(root, 'src', 'manifest.json')
const envPath = join(root, '.env.local')

const restore = process.argv.includes('--restore')
const manifest = readFileSync(manifestPath, 'utf8')

// 定位 mp-weixin 块（从 "mp-weixin" 起，到文件尾或下一个顶层块）里第一个 appid 字段
const blockStart = manifest.indexOf('"mp-weixin"')
if (blockStart < 0) {
  console.error('✗ manifest.json 里找不到 "mp-weixin" 块')
  process.exit(1)
}
const appidRe = /("appid"\s*:\s*")([^"]*)(")/
const rest = manifest.slice(blockStart)
const m = rest.match(appidRe)
if (!m) {
  console.error('✗ mp-weixin 块里找不到 "appid" 字段')
  process.exit(1)
}
const absIndex = blockStart + m.index

if (restore) {
  if (!m[2]) {
    console.log('ⓘ manifest.json 的 mp-weixin.appid 已是空值，无需还原')
    process.exit(0)
  }
  const out = manifest.slice(0, absIndex) + m[1] + '' + m[3] + manifest.slice(absIndex + m[0].length)
  writeFileSync(manifestPath, out)
  console.log('✓ 已还原：mp-weixin.appid → ""（可以安全提交了）')
  process.exit(0)
}

// ---- 注入 ----
if (!m[2]) {
  let appid = process.env.WX_APPID || ''
  if (!appid && readEnvSafe(envPath)) {
    appid = (readEnvSafe(envPath).match(/^WX_APPID\s*=\s*(\S+)\s*$/m) || [])[1] || ''
  }
  if (!appid) {
    console.error('✗ .env.local 里没有 WX_APPID —— 按格式补一行：WX_APPID=wx????????????????')
    process.exit(1)
  }
  if (!/^wx[0-9a-f]{16}$/.test(appid)) {
    console.error(`✗ WX_APPID 格式不对（应为 wx + 16 位十六进制）：${appid}`)
    process.exit(1)
  }
  const out = manifest.slice(0, absIndex) + m[1] + appid + m[3] + manifest.slice(absIndex + m[0].length)
  writeFileSync(manifestPath, out)
  console.log(`✓ 已注入 mp-weixin.appid（${appid.slice(0, 4)}****）—— 用完记得 npm run appid:restore 再提交！`)
} else {
  console.log('ⓘ manifest.json 里已有 appid（可能之前注入过），跳过。要还原请跑 npm run appid:restore')
}

function readEnvSafe(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

/**
 * 微信小程序端构建（自动携带 AppID）—— 2026-09-27 新增
 *
 * 为什么需要它
 * ------------
 * `uni build -p mp-weixin` 会把 `src/manifest.json` 里 `mp-weixin.appid` 的值
 * **原样**写进产物 `dist/build/mp-weixin/project.config.json`。
 * 而本仓库的 manifest 里 appid **永远是空字符串**（2026-09-18 GitHub 密钥扫描
 * 告警后清史重写，见 miniprogram/README.md 第 12 条）。
 *
 * 空 appid 被微信开发者工具读到之后，工具会把它**自动改写成 `touristappid`**
 * （游客模式），并把工具栏的「预览 / 真机调试 / 上传」三个按钮**全部置灰** ——
 * 用户看到的现象就是「点了没反应」。
 *
 * 旧流程是「appid:inject → 构建 → appid:restore」三步手动，忘掉任意一步就会
 * 中招；而且忘记 restore 还会让真实 AppID 进入 git 工作区（发版会被拒、有泄漏风险）。
 *
 * 本脚本改成**构建之后处理产物**：源码 manifest 全程不碰，从根上杜绝泄漏。
 *
 * 用法
 * ----
 *   npm run build:mp-weixin        # 推荐：构建 + 自动写入产物 appid
 *   npm run build:mp-weixin:raw    # 只构建（产物 appid 会空，工具将退回游客模式）
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const OUT_DIR = join(root, 'dist', 'build', 'mp-weixin')
const OUT_CONFIG = join(OUT_DIR, 'project.config.json')
const PRIVATE_CONFIG = join(OUT_DIR, 'project.private.config.json')
const ENV_FILE = join(root, '.env.local')

/** 读取合规 AppID：优先环境变量，其次 .env.local（格式必须是 wx + 16 位十六进制） */
function readAppid() {
  const fromEnv = process.env.WX_APPID || ''
  if (/^wx[0-9a-f]{16}$/.test(fromEnv)) return fromEnv
  if (!existsSync(ENV_FILE)) return ''
  const m = readFileSync(ENV_FILE, 'utf8').match(/^WX_APPID\s*=\s*(\S+)\s*$/m)
  const v = m ? m[1] : ''
  return /^wx[0-9a-f]{16}$/.test(v) ? v : ''
}

console.log('▶ 1/2 构建小程序产物（uni build -p mp-weixin）…')

// 开发者工具生成的本地设置（含「不校验合法域名」等）保存在 private 配置里，
// uni 清空 outDir 时可能一并删掉 ⇒ 先读进内存，构建后按需补回。
const privateBackup = existsSync(PRIVATE_CONFIG) ? readFileSync(PRIVATE_CONFIG, 'utf8') : null

const r = spawnSync('npm', ['run', 'build:mp-weixin:raw'], {
  stdio: 'inherit',
  shell: true,
  cwd: root
})
if (r.status !== 0) {
  console.error('\n✗ 构建失败，产物配置未改动（源码 manifest 全程未被修改）。')
  process.exit(r.status == null ? 1 : r.status)
}

if (privateBackup && !existsSync(PRIVATE_CONFIG)) {
  writeFileSync(PRIVATE_CONFIG, privateBackup, 'utf8')
  console.log('✓ 已补回 project.private.config.json（开发者工具的本地设置）')
}

console.log('\n▶ 2/2 把真实 AppID 写入产物 project.config.json（源码不动）…')

if (!existsSync(OUT_CONFIG)) {
  console.error(`✗ 找不到 ${OUT_CONFIG} —— 构建似乎没有产出项目配置。`)
  process.exit(1)
}

const appid = readAppid()
if (!appid) {
  console.warn('⚠ 没有找到合规的 WX_APPID（应为 wx + 16 位十六进制）。')
  console.warn('  ⇒ 产物 appid 仍为空，微信开发者工具会退回「游客模式」，')
  console.warn('    届时「预览 / 真机调试 / 上传」三个按钮都是灰的、点了没反应。')
  console.warn('  解法：在 miniprogram/.env.local 里补一行 WX_APPID=wx????????????????')
  process.exit(0)
}

const raw = readFileSync(OUT_CONFIG, 'utf8')
const next = raw.replace(/("appid"\s*:\s*")[^"]*(")/, (whole, head, tail) =>
  head + appid + tail
)
if (next === raw) {
  console.warn('⚠ 没能在 project.config.json 里定位 appid 字段，已跳过写入。')
  process.exit(0)
}
writeFileSync(OUT_CONFIG, next, 'utf8')

const written = (readFileSync(OUT_CONFIG, 'utf8').match(/"appid"\s*:\s*"([^"]*)"/) || [])[1] || ''
console.log(`✓ 产物 appid = ${written.slice(0, 4)}****（长度 ${written.length}）`)
console.log('ⓘ 若微信开发者工具此刻正开着，请「项目 → 重新打开」或点刷新，让它重读这份配置。')

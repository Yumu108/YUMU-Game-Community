#!/usr/bin/env node
/**
 * 小程序端「事件修饰符」守卫 —— 拦住 `@click.self` 这类**只对 H5 生效**的写法。
 *
 * ── 为什么需要它（2026-09-26 真实故障）──────────────────────────────
 * 详情页举报弹层原来把关闭逻辑写成：
 *     <view class="rsheet" @click.self="reportSheet = false">
 * H5 端编译成 `self: e => e.target !== e.currentTarget`（正常）；
 * **小程序端 uni-app 把这个修饰符直接丢掉了** —— 产物里只剩
 *     <view class="rsheet" bindtap="{{ak}}">
 * 没有任何判断。而 `bindtap` 是**冒泡**的，于是「点任意一个举报理由」都会冒到
 * 容器上 ⇒ 弹层当场关掉（用户实报：一点选项就退回帖子）。
 *
 * 🚨 为什么 140 项 H5 回归一条都没抓到：那一整套跑的是 Chromium，H5 端本来就是对的。
 *    **跨端语义不一致的写法，只能靠源头静态检查兜住。**
 *
 * 已实测（核对过本仓库编译产物）：
 *   · `.stop`  → 小程序的 `catchtap`（**有效**，白名单放行）
 *   · `.self`  → **被静默丢弃**（危险；用「独立遮罩兄弟节点 + @click」替代）
 *   · 其余修饰符（`.prevent` / `.capture` / `.once` / `.passive`）在小程序端的语义
 *     **未验证** ⇒ 一律拒绝；想用就先 `npm run build:mp-weixin`，去
 *     `dist/build/mp-weixin/**\/*.wxml` 里确认它编译成了什么，再决定是否加进白名单。
 *
 * 用法：cd miniprogram && node tests/lint-mp-modifiers.mjs   （退出码非 0 = 有违规）
 *      可选传入一个目录做**自我验证**（默认扫 src/）：
 *        node tests/lint-mp-modifiers.mjs /tmp/some-dir
 *      —— 存在的意义是能证明「把 .self 放回去它真的会红」，避免守卫自己是空转。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(HERE, '..')
const SRC = process.argv[2] ? resolve(process.argv[2]) : join(PKG, 'src')

/** 小程序端**实测有效**的修饰符白名单（新增前必须先在产物里验证） */
const ALLOWED = new Set(['stop'])

/** 事件绑定写法：`@click` / `@tap` / `v-on:click`，后面跟一个或多个 `.修饰符` */
const RE = /(?:@|v-on:)(click|tap|touchstart|touchmove|touchend|longpress|longtap)((?:\.[a-zA-Z]+)+)/g

/**
 * 先剥掉注释再扫描 —— 本项目注释里大量**举例说明**这些修饰符（"别用 @click.self"），
 * 不剥注释的话守卫会被自己的文档触发。按行数补齐，保证行号仍然准确。
 */
function stripComments(s) {
  const pad = (m) => '\n'.repeat((m.match(/\n/g) || []).length)
  return s
    .replace(/<!--[\s\S]*?-->/g, pad)
    .replace(/\/\*[\s\S]*?\*\//g, pad)
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return walk(p)
    return /\.(vue|nvue)$/.test(e.name) ? [p] : []
  })
}

const bad = []
for (const file of walk(SRC)) {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
  lines.forEach((line, i) => {
    RE.lastIndex = 0
    let m
    while ((m = RE.exec(line))) {
      const used = m[2].slice(1).split('.').filter((x) => !ALLOWED.has(x))
      if (!used.length) continue
      bad.push({
        file: relative(PKG, file).replace(/\\/g, '/'),
        line: i + 1,
        mods: used.join('.'),
        text: line.trim().slice(0, 96)
      })
    }
  })
}

if (!bad.length) {
  console.log('✅ 小程序端事件修饰符检查通过（无 .self 等未验证修饰符）')
  process.exit(0)
}

console.error(`❌ 发现 ${bad.length} 处小程序端**不可靠**的事件修饰符：\n`)
bad.forEach((b) => console.error(`   ${b.file}:${b.line}   .${b.mods}\n     ${b.text}`))
console.error(`
修法：
  · 「点遮罩关闭、点内容不关闭」⇒ 用**独立的遮罩兄弟节点**，不要用 .self：
      <view class="rsheet">
        <view class="rsheet__mask" @click="open = false"></view>
        <view class="rsheet__panel">…</view>   <!-- 容器上没有 click，就不会被冒泡误关 -->
      </view>
  · 想用别的修饰符 ⇒ 先 \`npm run build:mp-weixin\`，到 dist/build/mp-weixin/**/*.wxml
    确认它编译成了 catchtap 之类的有效形式，再把名字加进本文件的 ALLOWED。
`)
process.exit(1)

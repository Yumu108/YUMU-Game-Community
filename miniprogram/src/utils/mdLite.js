/**
 * 轻量 Markdown → `rich-text` 可用的 HTML。
 *
 * ┌ 为什么不复用主站那套 ────────────────────────────────
 * │ 主站（frontend/src/components/AiAssistant.vue）用 `v-html` 直接把 HTML 插进 DOM。
 * │ **小程序不支持 `v-html`** —— 那是 Vue 浏览器端的指令，编译到小程序会被丢弃
 * │ （同 `@click.self` 那类「静默消失」的坑，构建不报错、页面上什么都看不到）。
 * │ 小程序里唯一能渲染富文本的是 `<rich-text :nodes="...">`，它只认一批受限标签，
 * │ 且**不认 class**（只能写内联 style）。所以这里直接产出带内联样式的 HTML 片段。
 * └────────────────────────────────────────────────────
 *
 * 🚨 安全：AI 回复是**外部内容**（大模型输出，可能被提示注入），
 *   必须当不可信数据处理 —— 先 `escapeHtml` 再做任何标签替换。
 *   顺序反了（先拼标签再转义）就等于把 XSS 直接交给模型。
 *
 * 🚨 本文件是**零依赖纯函数**，Node 下可直接单测（见 tests/mdLite.test.mjs）。
 */

/** 代码块在文本里的临时占位标记（用不可见控制字符，避免和正文撞车） */
const PH_L = '\u0000c'
const PH_R = '\u0000'
/** 围栏：三个反引号，可选语言标识 */
const FENCE_RE = /```[ \t]*[A-Za-z0-9+#._-]*[ \t]*\r?\n([\s\S]*?)```/g

/**
 * 正文字色。
 *
 * 🚨 `rich-text` 是**独立渲染层**，不继承页面 CSS（`.ai .bubble{color:...}` 对它无效），
 *   所有颜色只能写在 nodes 的内联样式里。漏了这一步的表现是：深色底上**看不到字**
 *   （渲染成默认黑字），而不是报错 —— 又是一个「静默错」。
 */
const TEXT_COLOR = '#e9e7f2'

const WRAP_OPEN = `<div style="color:${TEXT_COLOR};font-size:14px;line-height:1.7;word-break:break-word;">`

/** 行内样式片段（rich-text 不认 class，只能内联） */
const S = {
  h: (n) =>
    `font-size:${[0, 20, 18, 16, 15, 15, 15][n]}px;font-weight:700;margin:10px 0 6px;line-height:1.4;color:${TEXT_COLOR};`,
  quote: `margin:8px 0;padding:6px 10px;border-left:3px solid #7c5cff;background:rgba(124,92,255,0.1);color:#a49eb6;`,
  ul: `margin:4px 0;padding-left:16px;color:${TEXT_COLOR};`,
  code: `background:rgba(255,255,255,0.12);padding:1px 4px;border-radius:4px;font-size:12px;color:${TEXT_COLOR};`,
  pre: `margin:8px 0;padding:10px 12px;background:#0f0f17;border:1px solid #2a2538;border-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-all;color:${TEXT_COLOR};`
}

/** HTML 转义（五字符全转，AI 输出里出现 `<script>` 也不会被当标签执行） */
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => {
    if (c === '&') return '&amp;'
    if (c === '<') return '&lt;'
    if (c === '>') return '&gt;'
    if (c === '"') return '&quot;'
    return '&#39;'
  })
}

/**
 * Markdown → HTML 片段（可直接喂给 `<rich-text :nodes="...">`）。
 *
 * 支持的语法：围栏代码块、#~###### 标题、**加粗**、`行内代码`、
 * `> 引用`、`- / * / + 无序列表`、`1. 有序列表`、空行分段。
 * 其余原样保留（宁可少渲染，也不要因为「认错语法」把内容吃掉）。
 *
 * @param {string} md
 * @returns {string} HTML 片段
 */
export function mdToHtml(md) {
  if (md == null) return ''
  let s = String(md)
  if (!s) return ''

  // ① 先抽走围栏代码块：里面的内容不参与任何后续语法替换，
  //    否则代码里的 `**` `- ` 会被当成 markdown（渲染出来是坏的）。
  const blocks = []
  s = s.replace(FENCE_RE, (_m, code) => {
    blocks.push(String(code).replace(/\r?\n$/, ''))
    return PH_L + (blocks.length - 1) + PH_R
  })

  // ② 转义（必须在拼标签之前）
  s = escapeHtml(s)

  // ③ 块级语法 —— 每条的末尾换行一起吃掉，避免与后面的 `<br/>` 叠成空行。
  //
  // 🚨 这里**必须用贪婪 `(.*)`**，不能写 `(.*?)`：由于尾部的 `\r?\n?` 是可选的，
  //   惰性量词会让整个正则退化成「只匹配前缀标记」（如只吃掉 `- ` 三个字符），
  //   正文被留在标签**外面** —— 渲染出来是「空的列表项 + 裸露的正文」。
  //   实测证据（单测抓到）：`- 第一项` 曾渲染成 `<div …>• </div>第一项`。
  //   ⚠️ 同一条正则对**标题与引用**一样会退化，别只改列表。
  const trimEnd = (t) => String(t).replace(/[ \t]+$/, '')

  s = s.replace(/^(#{1,6})[ \t]+(.*)\r?\n?/gm, (_m, hashes, t) => {
    const n = hashes.length
    return `<h${n} style="${S.h(n)}">${trimEnd(t)}</h${n}>`
  })
  s = s
    .replace(/^&gt;[ \t]?(.*)\r?\n?/gm, (_m, t) => `<div style="${S.quote}">${trimEnd(t)}</div>`)
    .replace(/^[ \t]*[-*+][ \t]+(.*)\r?\n?/gm, (_m, t) => `<div style="${S.ul}">• ${trimEnd(t)}</div>`)
    .replace(/^[ \t]*(\d+)\.[ \t]+(.*)\r?\n?/gm, (_m, no, t) => `<div style="${S.ul}">${no}. ${trimEnd(t)}</div>`)

  // ④ 行内语法
  s = s
    .replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`\n]+?)`/g, `<span style="${S.code}">$1</span>`)

  // ⑤ 剩余换行
  s = s.replace(/\r?\n/g, '<br/>')

  // ⑥ 还原代码块（块内内容同样要转义）
  s = s.replace(new RegExp(PH_L + '(\\d+)' + PH_R, 'g'), (_m, i) => {
    const code = blocks[Number(i)]
    if (code === undefined) return ''
    return `<div style="${S.pre}">${escapeHtml(code)}</div>`
  })

  // ⑦ 包一层带正文色/字号/行高的容器：rich-text 不继承页面样式，
  //    裸文本（没有被块级标签包住的部分）全靠这一层上色。
  return s ? WRAP_OPEN + s + '</div>' : ''
}

/**
 * Markdown → 纯文本（`rich-text` 万一渲染异常时的兜底，也便于做断言/摘要）。
 * @param {string} md
 * @returns {string}
 */
export function mdToPlain(md) {
  if (md == null) return ''
  let s = String(md)
  s = s.replace(FENCE_RE, (_m, code) => String(code).replace(/\r?\n$/, ''))
  s = s.replace(/^#{1,6}[ \t]+/gm, '')
  // ⚠️ 这里处理的是**未转义**的原文，所以是 `>` 而不是 `&gt;`（别照抄 mdToHtml 的写法）
  s = s.replace(/^>[ \t]?/gm, '')
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, '· ')
  s = s.replace(/\*\*([^\n]+?)\*\*/g, '$1')
  s = s.replace(/`([^`\n]+?)`/g, '$1')
  return s.trim()
}

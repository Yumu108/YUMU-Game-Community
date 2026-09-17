/**
 * 正文处理 —— 帖子 `content` 可能是纯文本，也可能是富文本编辑器产生的 HTML。
 * 小程序不支持 `v-html`，这里统一转成「安全的纯文本 → 段落数组」，
 * 由页面用 `<text>` 渲染（**不解析 HTML**，天然免疫 XSS）。
 */

const ENTITIES = {
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&amp;': '&'
}

/**
 * HTML → 纯文本（保留换行语义）。
 * @param {string} html
 * @returns {string}
 */
export function stripHtml(html) {
  if (!html || typeof html !== 'string') return ''
  let s = html
  // 块级标签与 <br> 转成换行，避免段落被粘成一坨
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n')
  s = s.replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|section|article)\s*>/gi, '\n')
  s = s.replace(/<\s*(li)[^>]*>/gi, '· ')
  // 丢弃其余标签（含 script/style 的内容）
  s = s.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
  s = s.replace(/<[^>]+>/g, '')
  // 实体解码（&amp; 必须最后处理）
  s = s.replace(/&(nbsp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] || m)
  s = s.replace(/&amp;/g, '&')
  // 压缩多余空行
  return s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 正文 → 段落数组（已去空行）。
 * @param {string} raw
 * @returns {string[]}
 */
export function toParagraphs(raw) {
  const text = stripHtml(raw)
  if (!text) return []
  return text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 摘要：优先用后端给的 `summary`，否则从正文截取。
 * @param {object} post
 * @param {number} [max] 最大字数
 */
export function summaryOf(post, max = 60) {
  const s = post && (post.summary || stripHtml(post.content || ''))
  if (!s) return ''
  return s.length > max ? `${s.slice(0, max)}…` : s
}

// 轻量富文本渲染：正文以纯文本存储，图片/链接用安全标记语法
//   ![alt](url)      -> <img>
//   [text](url)      -> <a>
//
// 安全模型（阶段5 XSS 收口）：
//   1) 全文先 escapeHtml，消灭 < > & " ' 等原生 HTML 语义；
//   2) URL 仅允许 http(s):// 或 data:image/ 协议（协议白名单）；
//   3) URL / alt / text 进入属性值或文本前，**再做一次 escapeHtml（双重转义）**，
//      这样第一步生成的 &quot; 等实体会被再次转义成字面量，无法在属性上下文解码回引号，
//      从而杜绝 "属性逃逸注入 onerror/onload 等事件处理器" 这类 XSS；
//   4) 任何不满足白名单的标记整体回退为纯文本（已转义），绝不裸输出。

// 仅允许安全协议，且整体不含引号/尖括号/空白等可破坏属性的字符
// 支持：http(s):// 外链、data:image/ 内嵌图（兼容历史种子帖 base64）、/api/files/... 等同源相对路径
const SAFE_URL = /^(https?:\/\/[^'"<>\s]+|data:image\/[^'"<>\s]+|\/(?!\/)[^'"<>\s]+)$/i
// 装饰层放宽：仅允许 http/https 同源/同协议相对路径（站内链接也允许）
const DECO_SAFE_URL = /^(https?:\/\/[^'"<>\s]+|\/(?!\/)[^'"<>\s]+)$/i

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 属性值二次转义：escapeHtml 已把 " 变成 &quot;，再转义一次后浏览器只能看到字面量 &quot;
function escapeAttr(s) {
  return escapeHtml(s)
}

function isSafeUrl(url) {
  return SAFE_URL.test(url)
}

// ---- 9-07：@自动补全 / 站内用户提及链接 ----
// 自动补全选人后插入 markdown 链接 [@昵称](/user/123)：
//   - 渲染：直接变 <a href="/user/123">@昵称</a>（跳用户主页；链接文本不再被 renderMentions 二次包成嵌套 <a>）
//   - 通知：MentionParser 能扫到链接文本里的 @昵称（纯文本手打 @ 兜底仍可用）
//   - 编辑回显：与图片/链接一样以 markdown 形态展示（与现有编辑器行为一致）

/** 生成"提及链接"markdown（@自动补全选人后插入） */
export function mentionMarkdown(nickname, userId) {
  const text = escapeMentionText(nickname)
  const uid = Number.parseInt(userId, 10)
  if (!text || !Number.isFinite(uid)) return '@' + (nickname || '')
  return `[@${text}](/user/${uid})`
}
/** 昵称进链接文本：剔除会破坏 []() 语法的字符（显示时用户基本不会用到） */
function escapeMentionText(nick) {
  return String(nick || '').replace(/[[\]()]/g, (c) => ({ '[': '［', ']': '］', '(': '（', ')': '）' })[c])
}

export function renderRichText(src) {
  if (!src) return ''
  // 1) 全文转义，消灭原生 HTML 语义
  let html = escapeHtml(src)
  // 1.5) 9-07：站内用户提及链接 [@昵称](/user/123) 先提取成占位符，
  //      渲染为"用户主页链接"并跳过 renderMentions（避免 <a> 嵌套 <a> 的非法 HTML）
  const userLinks = []
  html = html.replace(/\[([^\]]*)\]\((\/user\/\d+)\)/g, (m, text, url) => {
    userLinks.push(
      `<a href="${url}" data-internal-link="${escapeAttr(url)}" data-mention-uid="${url.slice('/user/'.length)}" ` +
      `style="color:var(--brand);font-weight:600;text-decoration:none;">${text}</a>`
    )
    return `\u0000M${userLinks.length - 1}\u0000`
  })
  // 2-3) 图片 ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    if (!isSafeUrl(url)) return escapeHtml(m) // 不安全：整体当纯文本
    return (
      `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy" ` +
      `style="display:block;max-width:100%;max-height:420px;width:auto;height:auto;` +
      `object-fit:contain;border-radius:8px;margin:10px 0;background:var(--bg-3);">`
    )
  })
  // 2-3) 链接 [text](url)（已提取的用户链接此时为占位符，不受影响）
  //   内部链接（同源相对路径 / 开头）标记为 data-internal-link，由全局委托点击走客户端路由（避免整页硬刷新卡顿）；
  //   外链仍新开标签页。
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    if (!isSafeUrl(url)) return escapeHtml(m)
    const safe = escapeAttr(url)
    if (url.startsWith('/')) {
      return (
        `<a href="${safe}" data-internal-link="${safe}" ` +
        `style="color:var(--brand);text-decoration:underline;">${escapeHtml(text)}</a>`
      )
    }
    return (
      `<a href="${safe}" target="_blank" rel="noopener noreferrer" ` +
      `style="color:var(--brand);text-decoration:underline;">${escapeHtml(text)}</a>`
    )
  })
  // 4) 换行（纯文本 @昵称 不再自动转链接 —— 只有选中补全插入的 [@昵称](/user/N) 才是可点提及）
  html = html.replace(/\n/g, '<br>')
  // 5) 还原用户提及链接占位符
  html = html.replace(/\u0000M(\d+)\u0000/g, (m, i) => userLinks[Number(i)] || m)
  return html
}

/**
 * 9-07：装饰层（编辑器"显示视图"）HTML 生成
 *   - 把 markdown 解析成"渲染视图"：[@昵称](/user/uid) → 蓝色 @昵称（仅选中补全插入的才是可点提及）；
 *     ![alt](url) → 蓝色"图片"标签；[text](url) → 蓝色文本；手打未选中的 @xxx 视为普通符号，无链接
 *   - 中括号与 url 段用 visibility:hidden 的 span 占位（保留字符宽度）
 *   - 字符数严格 1:1（装饰层总字符数 = markdown 原文字符数），保证光标位置与 textarea 字符串索引对齐
 *   - 换行符 \n 渲染为 deco 占位 span
 *
 * 关键：用 NUL token 隔离，避免后续 replace 在已生成的 deco 标签内再匹配（经典 regex 递归）
 */
export function decorationHtmlFor(src) {
  if (!src) return ''
  let s = escapeHtml(src)
  // 1) 用 token 占位所有 markdown 语法段；token 不会被后续任何 regex 匹配
  const slots = [] // token → deco HTML
  const PH = '\u0000'
  const place = (re, build) => {
    s = s.replace(re, (m, ...args) => {
      const idx = slots.length
      slots.push(build(m, ...args))
      return PH + idx + PH
    })
  }
  // 站内用户链接 [@X](/user/N) —— 优先
  place(/\[([^\]]*)\]\((\/user\/\d+)\)/g, (_m, text, url) =>
    `<span class="deco-hidden">[</span>` +
    `<a class="deco-link deco-mention" href="${escapeHtml(url)}" data-mention-uid="${escapeHtml(url.slice('/user/'.length))}" @click.prevent>${text}</a>` +
    `<span class="deco-hidden">](${escapeHtml(url)})</span>`
  )
  // 图片 ![alt](url)
  place(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) =>
    `<span class="deco-hidden">![</span>` +
    `<span class="deco-img">${escapeHtml(alt || '图片')}</span>` +
    `<span class="deco-hidden">](${escapeHtml(url)})</span>`
  )
  // 普通链接 [text](url) —— 仅安全 URL 才渲染为可点 deco-link；不安全整体回退为纯文本
  place(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
    if (!DECO_SAFE_URL.test(url)) return text // 整段 markdown 退化为纯文本（token 替换时填回 text）
    return `<span class="deco-hidden">[</span>` +
      `<a class="deco-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${text}</a>` +
      `<span class="deco-hidden">](${escapeHtml(url)})</span>`
  })
  // 换行（纯文本 @昵称 不再渲染为链接，仅选中补全插入的 [@昵称](/user/N) 才会高亮可点）
  s = s.replace(/\n/g, '<span class="deco-hidden">\n</span>')
  // 还原 token
  s = s.replace(new RegExp(`${PH}(\\d+)${PH}`, 'g'), (_m, i) => slots[Number(i)] || '')
  return s
}

// 去标记/去标签，用于卡片摘要与发帖校验判空
export function stripMarkdown(src) {
  if (!src) return ''
  return src
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[#*_>`~]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

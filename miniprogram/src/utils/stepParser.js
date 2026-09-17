/**
 * 阅读拆解器 —— 本项目**最大的差异化亮点**。
 *
 * 背景：社区里的内容都是「一整段长文」，而小程序的阅读场景是「边玩边看」，
 * 需要能一眼扫到要点、能定位到某一条。
 *
 * 关键取舍：**解析放在前端做，后端一行不改。**
 *  · 现有内容已经存在，用「前端适配层」换取**零数据迁移成本**；
 *  · 同时给后续把结构落库（新字段）留出了演进路径 —— 将来二选一即可。
 *
 * 两种产出：
 *  · `step`  —— 正文本来就带序号/小标题，能切出真正的「步骤」
 *  · `point` —— 正文是「一整段散文」，按句拆成「要点」（实测线上 36 篇**全部**属于这类）
 *
 * 切分规则（按优先级）：
 *  1. 显式序号：`第一步` / `①` / `1.` / `1、` / `（1）` / `Step 1`   → step
 *  2. 小标题：`## xxx` / `【xxx】`                                    → step
 *  3. 空行分段兜底：段落数 > 3 时按段落成卡                           → step
 *  4. 单段多句：段落 ≤ 3 且句子 ≥ 3 时按句成卡（「要点模式」）        → point
 *
 * 全部失败 → 返回 `null`，调用方退化为普通正文渲染（**不报错、不空屏**）。
 */
import { stripHtml } from './content.js'

/** 显式序号开头 */
const NUM_HEAD =
  /^\s*(?:第\s*[一二三四五六七八九十百\d]{1,3}\s*[步条点]|[\u2460-\u2473]|\d{1,2}\s*[.、)）]|[(（]\s*\d{1,2}\s*[)）]|step\s*\d{1,2})\s*[:：.、]?\s*/i

/** `【小标题】` 或 `[小标题]` 开头 */
const BRACKET_HEAD = /^\s*[【[]\s*([^】\]]{1,24})\s*[】\]]\s*[:：]?\s*/

/** `## 小标题` */
const MD_HEAD = /^\s*#{2,4}\s*(.+?)\s*$/

/** 句末标点（用于要点拆分；不含逗号，避免把长句切碎） */
const SENTENCE_END = /([。！？!?；;])/

/** 卡片数量上限，避免极端长文切出几十张卡 */
const MAX_ITEMS = 12

/**
 * @param {string} raw 帖子正文（纯文本或 HTML）
 * @returns {{kind:'step'|'point', items:Array<{index:number,title:string,desc:string}>}|null}
 *          null = 无法拆解（调用方退化为普通正文）
 */
export function parseReading(raw) {
  const text = stripHtml(raw)
  if (!text) return null

  const blocks = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (!blocks.length) return null

  const step = byNumber(blocks) || byHeading(blocks) || byParagraph(blocks)
  if (step) return { kind: 'step', items: step }

  const point = bySentence(blocks)
  if (point) return { kind: 'point', items: point }

  return null
}

/* ---------------- 规则 1：显式序号 → step ---------------- */
function byNumber(blocks) {
  if (blocks.length < 2) return null
  const hitCount = blocks.filter((b) => NUM_HEAD.test(b)).length
  if (hitCount < 2) return null

  const items = []
  let cur = null
  for (const b of blocks) {
    if (NUM_HEAD.test(b)) {
      const title = b.replace(NUM_HEAD, '').trim()
      cur = { title: title || `第 ${items.length + 1} 步`, desc: '' }
      items.push(cur)
    } else if (cur) {
      // 序号后紧跟的续行并入上一步的描述
      cur.desc = cur.desc ? `${cur.desc} ${b}` : b
    }
    // 首个序号之前的前言直接丢弃（避免把导语塞进卡片）
  }
  return finalize(items)
}

/* ---------------- 规则 2：小标题 → step ---------------- */
function byHeading(blocks) {
  if (blocks.length < 2) return null
  const hasBracket = blocks.filter((b) => BRACKET_HEAD.test(b)).length >= 2
  const hasMd = blocks.filter((b) => MD_HEAD.test(b)).length >= 2
  if (!hasBracket && !hasMd) return null

  const items = []
  let cur = null
  for (const b of blocks) {
    const m = hasBracket ? b.match(BRACKET_HEAD) : b.match(MD_HEAD)
    if (m) {
      const title = hasBracket ? m[1].trim() : m[1].replace(/[#\s]+$/, '').trim()
      const rest = b.slice(m[0].length).trim()
      cur = { title, desc: rest }
      items.push(cur)
    } else if (cur) {
      cur.desc = cur.desc ? `${cur.desc} ${b}` : b
    }
  }
  return finalize(items)
}

/* ---------------- 规则 3：多段兜底 → step ---------------- */
function byParagraph(blocks) {
  if (blocks.length <= 3) return null

  const items = blocks.map((b, i) => {
    // 段落首句是短句（<= 18 字）时提出来当标题，其余留作描述
    const m = b.match(/^(.{2,18}?)[。：:！!？?]\s*(.+)$/)
    if (m) return { title: m[1], desc: m[2] }
    return { title: `第 ${i + 1} 步`, desc: b }
  })
  return finalize(items)
}

/* ---------------- 规则 4：单段多句 → point ---------------- */
/**
 * 实测线上 36 篇正文**全部**是「一整段散文」，没有任何序号。
 * 但它们本身就是分点写的（如「前期…中期…逆风…」），
 * 只是被写成了一个段落 —— 这里按句拆开，让手机上能一眼扫一条。
 */
function bySentence(blocks) {
  if (blocks.length > 3) return null

  const sentences = splitSentences(blocks.join(' '))
  if (sentences.length < 3) return null

  const items = sentences.map((s) => {
    // 有「前期思路：…」这种天然分隔时，冒号前提为标题、其后作描述
    const m = s.match(/^(.{2,18}?)[：:]\s*(.+)$/)
    if (m) return { title: m[1], desc: m[2] }
    // 否则整句作标题、不写描述 —— 卡片左侧本来就有序号圆圈，正文里再写一次「要点 N」是冗余
    return { title: s.replace(/[。！？!?；;]+$/, ''), desc: '' }
  })
  return finalize(items)
}

/**
 * 按句末标点切句，**保留标点**，并丢掉过短的碎片。
 * 不用正则 lookbehind —— 小程序老版本引擎对它支持不稳。
 */
function splitSentences(text) {
  const parts = text.split(SENTENCE_END)
  const out = []
  for (let i = 0; i < parts.length; i += 2) {
    const s = (parts[i] + (parts[i + 1] || '')).trim()
    if (s.length >= 6) out.push(s)
    else if (out.length && s) out[out.length - 1] += s // 太短 → 并回上一句
  }
  return out
}

/* ---------------- 收尾 ---------------- */
function finalize(items) {
  const cleaned = items
    .map((s) => ({
      title: tidy(s.title, 30),
      desc: tidy(s.desc, 400)
    }))
    .filter((s) => s.title || s.desc)
    .slice(0, MAX_ITEMS)

  if (cleaned.length < 2) return null
  return cleaned.map((s, i) => ({
    index: i + 1,
    title: s.title || `第 ${i + 1} 步`,
    desc: s.desc
  }))
}

function tidy(s, max) {
  const v = String(s || '').trim()
  return v.length > max ? `${v.slice(0, max)}…` : v
}

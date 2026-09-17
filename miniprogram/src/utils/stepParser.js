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
 *  · `point` —— 正文是「一整段散文」，按句拆成「要点」
 *
 * 切分规则（按优先级）：
 *  1. 显式序号：`第一步` / `①` / `1.` / `1、` / `（1）` / `Step 1`   → step
 *  2. 小标题：`## xxx` / `【xxx】`                                    → step
 *  3. 空行分段兜底：段落数 > 3 时按段落成卡                           → step
 *  4. 单段多句：段落 ≤ 3 且句子 ≥ 3 时按句成卡（「要点模式」）        → point
 *
 * 全部失败 → 返回 `null`，调用方退化为普通正文渲染（**不报错、不空屏**）。
 *
 * 🚨 这个文件的头号纪律：**不许静默丢内容**。
 *   它是「从原文里挑东西给用户看」，一旦挑漏，用户看到的是**看起来完整、
 *   其实缺了一部分**的文章 —— 比报错危险得多（报错至少用户知道不对）。
 *   2026-09-17 内容富化后，真实长文把三处静默丢失全打了出来（见各函数注释），
 *   现在：要么完整保留，要么由页面**显式提示**（`truncated` / `omitted`）。
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

/**
 * 卡片数量上限。
 *
 * 🚨 原值 12，**实测直接丢内容**：线上《艾尔登法环》那篇原文有 13 条以上编号，
 *   第 13 条「别在进 DLC 前把洗点道具用完」被静默切掉；而卡片模式是**默认模式**
 *   ⇒ 用户以为看到的就是全部（原文模式里其实有）。
 *   现提到 60 —— 实测最长的帖仅 16 条候选，正常内容**不会**触发；
 *   真触发时由 `truncated` / `omitted` 让页面显式提示，不得再静默。
 */
const MAX_ITEMS = 60

/**
 * 单张卡的描述上限。
 * 原值 400 实测被触发（有一张卡正好 401 = 400 字 + 省略号）。
 * 正文是别人的原创内容，不该由前端替作者删减 —— 放宽到 1200（远超实测最长条目）。
 */
const MAX_DESC = 1200

/** 标题上限：这是**展示需要**（卡片标题本该一行），截断可接受，且有「原文模式」兜底。 */
const MAX_TITLE = 30

/**
 * @param {string} raw 帖子正文（纯文本或 HTML）
 * @returns {{kind:'step'|'point', intro:string, truncated:boolean, omitted:number,
 *            items:Array<{index:number,title:string,desc:string,section:string}>}|null}
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
  if (step) return { kind: 'step', ...step }

  const point = bySentence(blocks)
  if (point) return { kind: 'point', ...point }

  return null
}

/* ---------------- 规则 1：显式序号 → step ---------------- */
/**
 * 🚨 老实现有两处**静默丢内容**，内容富化后被真实长文打出原形：
 *   ① 「首个序号之前的前言直接丢弃」—— 那通常是交代背景的导语，
 *      丢掉后读者少了上下文（如「DLC 的难度是按你打完本体的后期强度设计的…」）；
 *   ② `【第一梯队：不做会直接卡关】` 这类**分组标题行**既非序号也非正文，
 *      掉进 else 分支后或被并进上一条、或被丢掉 —— 文章的组织结构整个消失，
 *      12 张平等的卡片看不出「第一/二/三梯队」的层次。
 *   现在：前言 → `intro`；分组标题 → 记到其后条目上（`section`），由页面渲染成小节标题。
 */
function byNumber(blocks) {
  if (blocks.length < 2) return null
  const hitCount = blocks.filter((b) => NUM_HEAD.test(b)).length
  if (hitCount < 2) return null

  const items = []
  const intro = []
  let cur = null
  let section = ''

  for (const b of blocks) {
    if (NUM_HEAD.test(b)) {
      // 🚨 序号后的整行**不能**都当标题：title 有 30 字展示上限，超出部分会被 `tidy` 截掉。
      //   线上《艾尔登法环》那篇每条约 90 字，16 条合计被截掉约 1000 字，
      //   整篇保全率只剩 55%（用户看到的是「每条都缺了后半句」）。
      //   这里把「首句」当标题、其余落到 desc —— 一个字都不丢。
      const { title, desc } = headAndTail(b.replace(NUM_HEAD, '').trim())
      cur = { title: title || `第 ${items.length + 1} 步`, desc, section }
      items.push(cur)
      continue
    }
    // 分组标题：不占序号、也不是描述，只切换「当前分组」
    const head = pureHeading(b)
    if (head) {
      section = head
      continue
    }
    if (cur) {
      // 序号后紧跟的续行并入上一步的描述
      cur.desc = cur.desc ? `${cur.desc} ${b}` : b
    } else {
      intro.push(b) // 首个序号之前 → 导语（原来是丢掉）
    }
  }
  return finalize(items, intro.join('\n'))
}

/**
 * 整行**只是**一个分组标题吗？`【第一梯队：不做会直接卡关】` → 返回标题文本。
 * 与 `【标题】正文…` 区分：后者括号后还有内容，那是条目而不是分组。
 * @returns {string} 是则返回标题，否则返回 ''
 */
function pureHeading(b) {
  const m = b.match(BRACKET_HEAD)
  if (!m) return ''
  return b.slice(m[0].length).trim() ? '' : m[1].trim()
}

/**
 * 把一段文本拆成「卡片标题 + 剩余描述」，**保证一个字都不丢**。
 *
 * 为什么必须有这个函数：卡片标题有条数/长度上限（一行放得下才叫标题），
 * 而正文条目常常是「一句短标题 + 一长段解释」的形态。若把整条都塞进 title，
 * 超限部分会被 `tidy` 截掉 —— 那是在替作者删正文。
 *
 * 取值顺序：① 首个句末/冒号标点处断开（最自然）→ ② 没有标点就按长度硬切，
 * 剩余部分一律落入 `desc`（真正截断只可能发生在 MAX_DESC 这个极高的阈值上）。
 *
 * @param {string} text
 * @param {number} [maxTitle] 标题软上限（默认 30）
 * @returns {{title:string, desc:string}}
 */
function headAndTail(text, maxTitle = MAX_TITLE) {
  const s = String(text || '').trim()
  if (!s) return { title: '', desc: '' }

  // ① 标题尽量取在标点处：`2~30 字 + 标点 + 其余`（`[\s\S]` 而非 `.` —— 段内可能残留换行）
  const m = s.match(/^([\s\S]{2,30}?)[。：:！!？?；;]\s*([\s\S]+)$/)
  if (m) return { title: m[1], desc: m[2] }

  // ② 没有可用的断点：按长度切，超出部分进 desc 而不是丢掉
  if (s.length > maxTitle) return { title: s.slice(0, maxTitle), desc: s.slice(maxTitle) }

  return { title: s, desc: '' }
}

/* ---------------- 规则 2：小标题 → step ---------------- */
function byHeading(blocks) {
  if (blocks.length < 2) return null
  const hasBracket = blocks.filter((b) => BRACKET_HEAD.test(b)).length >= 2
  const hasMd = blocks.filter((b) => MD_HEAD.test(b)).length >= 2
  if (!hasBracket && !hasMd) return null

  const items = []
  const intro = []
  let cur = null
  for (const b of blocks) {
    const m = hasBracket ? b.match(BRACKET_HEAD) : b.match(MD_HEAD)
    if (m) {
      const title = hasBracket ? m[1].trim() : m[1].replace(/[#\s]+$/, '').trim()
      const rest = b.slice(m[0].length).trim()
      cur = { title, desc: rest, section: '' }
      items.push(cur)
    } else if (cur) {
      cur.desc = cur.desc ? `${cur.desc} ${b}` : b
    } else {
      intro.push(b) // 首个标题之前 → 导语
    }
  }
  return finalize(items, intro.join('\n'))
}

/* ---------------- 规则 3：多段兜底 → step ---------------- */
function byParagraph(blocks) {
  if (blocks.length <= 3) return null

  const items = blocks.map((b, i) => {
    // 段落首句是短句（<= 18 字）时提出来当标题，其余留作描述
    const m = b.match(/^(.{2,18}?)[。：:！!？?]\s*(.+)$/)
    if (m) return { title: m[1], desc: m[2], section: '' }
    return { title: `第 ${i + 1} 步`, desc: b, section: '' }
  })
  return finalize(items)
}

/* ---------------- 规则 4：单段多句 → point ---------------- */
/**
 * 线上有一批正文是「一整段散文」，没有任何序号。
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
    if (m) return { title: m[1], desc: m[2], section: '' }
    // 否则整句作标题、不写描述 —— 卡片左侧本来就有序号圆圈，正文里再写一次「要点 N」是冗余。
    // ⚠️ 但句子一旦超过标题上限就必须留 desc，否则同样会被 tidy 截掉半句。
    return { ...headAndTail(s.replace(/[。！？!?；;]+$/, '')), section: '' }
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
/**
 * @param {Array<{title:string,desc:string,section?:string}>} items
 * @param {string} [intro] 首个条目之前的导语（有则保留，不再丢弃）
 * @returns {{intro:string,truncated:boolean,omitted:number,items:Array}|null}
 */
function finalize(items, intro = '') {
  const cleaned = items
    .map((s) => ({
      title: tidy(s.title, MAX_TITLE),
      desc: tidy(s.desc, MAX_DESC),
      section: (s.section || '').trim()
    }))
    .filter((s) => s.title || s.desc)

  const omitted = Math.max(0, cleaned.length - MAX_ITEMS)
  const kept = cleaned.slice(0, MAX_ITEMS)

  if (kept.length < 2) return null

  return {
    intro: String(intro || '').trim(),
    truncated: omitted > 0,
    omitted,
    items: kept.map((s, i) => ({
      index: i + 1,
      title: s.title || `第 ${i + 1} 步`,
      desc: s.desc,
      section: s.section
    }))
  }
}

function tidy(s, max) {
  const v = String(s || '').trim()
  return v.length > max ? `${v.slice(0, max)}…` : v
}

/**
 * 关键词 → 「精确筛选值」的端内解析（类型 / 平台）。
 *
 * ============================ 为什么必须端内做 ============================
 * 后端两个接口各缺一半，谁都单独顶不上：
 *
 * | 接口                    | keyword 匹配范围                      | 致命缺陷                  |
 * |-------------------------|---------------------------------------|---------------------------|
 * | `/games`                | 只 `like(name/description)`           | **不匹配 genre / platform** |
 * | `/search?type=game`     | name / platform / genre / **publisher** | 硬编码 `LIMIT 8`、**无分页无总数** |
 *
 * ⇒ 结论：把「类型名 / 平台名当搜索词」这件事放端内——先把词解析成**精确值**，
 *   再换用 `/games?genre=` `/games?platform=` 查。这样既有服务端分页，
 *   又能拿到 `total`，还能和游戏库页共用同一套口径。
 *
 * 📌 2026-09-21 的由来：用户在搜索页搜「资讯」，却搜出了《仙剑奇侠传》——
 *   查下来是 `/search?type=game` 把 `publisher`（大宇**资讯**）也当匹配字段，
 *   属于公司名撞词；同一个词在游戏库页却是 0 结果（那边只 like 名称/简介）。
 *   两处口径不一致 + 8 条上限，是这次重构的直接原因。
 */

import { PLATFORM } from '../api/config'

/**
 * 平台别名表 —— 用户嘴里的说法和库里的字面量不一样，这里做一次归一。
 *
 * ⚠️ `value` 必须与后端 `game.platform` 的字面量完全一致（多平台 / PC / 主机 / 手机），
 *   否则筛出来是空。展示名（手机 → 手游）交给 `utils/format.js#platformLabel`。
 *
 * 📌 为什么「平台」不在这张表里：`多平台` 含「平台」二字，若允许
 *   「别名是关键词的子串」这种宽匹配，用户搜「平台」就会莫名命中「多平台」。
 *   所以只保留「完全相等」和「关键词**比别名长**且包含别名」两种，见 matchPlatform。
 */
const PLATFORM_ALIASES = [
  { value: PLATFORM.MULTI, words: ['多平台', '全平台', '跨平台'] },
  { value: PLATFORM.PC, words: ['pc', '电脑', '端游', 'steam'] },
  { value: PLATFORM.CONSOLE, words: ['主机', 'console', 'ps5', 'ps4', 'switch', 'xbox'] },
  { value: PLATFORM.MOBILE, words: ['手机', '手游', '移动端', '安卓', 'ios'] }
]

/** 取出类型清单里的名字（兼容 `[{name}]` 与 `['RPG']` 两种形状） */
function genreNames(genres) {
  return (Array.isArray(genres) ? genres : [])
    .map((g) => (typeof g === 'string' ? g : g && g.name))
    .filter(Boolean)
}

/**
 * 关键词命中的类型名（没命中返回 `''`）。
 *
 * 匹配优先级：**完全相等 → 前缀（≥2 字）→ 包含（≥2 字）**，均不区分大小写。
 *
 * 📌 单字只认「完全相等」是**故意**的：否则输入「a」会把 ACT / AVG / ARPG / MMO…
 *   一锅端；输入「游」也会命中一堆不相关的类型。宁可搜不到，也不给假结果。
 *
 * @param {string} keyword 用户输入
 * @param {Array<{name:string}|string>} genres 类型清单（来自 ensureGameMeta）
 * @returns {string} 命中的类型名，未命中为 ''
 */
export function matchGenre(keyword, genres) {
  const kw = String(keyword || '').trim().toLowerCase()
  if (!kw) return ''
  const names = genreNames(genres)
  if (!names.length) return ''

  const exact = names.find((n) => n.toLowerCase() === kw)
  if (exact) return exact
  if (kw.length >= 2) {
    const pre = names.find((n) => n.toLowerCase().startsWith(kw))
    if (pre) return pre
    const inc = names.find((n) => n.toLowerCase().includes(kw))
    if (inc) return inc
  }
  return ''
}

/**
 * 关键词命中的平台字面量（没命中返回 `''`）。
 *
 * 只认两种关系，避免宽匹配误伤（见 PLATFORM_ALIASES 上的说明）：
 *   1. **完全相等**：`PC` → PC、`手游` → 手机、`主机` → 主机；
 *   2. **关键词更长且包含别名**：`手机游戏` → 手机、`pc端` → PC。
 * 单字一律不匹配（「机」不该命中「主机」）。
 *
 * @param {string} keyword 用户输入
 * @returns {string} 命中的平台字面量（多平台/PC/主机/手机），未命中为 ''
 */
export function matchPlatform(keyword) {
  const kw = String(keyword || '').trim().toLowerCase()
  if (!kw) return ''
  const hit = PLATFORM_ALIASES.find((a) =>
    a.words.some((w) => kw === w || (kw.length > w.length && kw.includes(w)))
  )
  return hit ? hit.value : ''
}

/**
 * 一次性解析 —— 类型优先于平台。
 *
 * 为什么类型优先：两者几乎不会同时命中（32 个类型名里没有「PC / 手机」这类词），
 * 真撞上时，类型筛选粒度更贴合「搜游戏」的意图。
 *
 * @returns {{genre:string, platform:string}} 两者都可能是 ''
 */
export function resolveKeywordFilter(keyword, genres) {
  const genre = matchGenre(keyword, genres)
  const platform = genre ? '' : matchPlatform(keyword)
  return { genre, platform }
}

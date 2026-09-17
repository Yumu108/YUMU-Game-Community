/**
 * 格式化工具 —— 图片地址、时间、游戏首字色块。
 */
import { ASSET_BASE } from '../api/config'

/* ==================== 图片 ==================== */

const ABSOLUTE = /^(https?:)?\/\/|^data:|^blob:/i

/**
 * 把后端返回的相对路径补成可直接渲染的地址。
 *
 * 后端会返回两种相对路径：
 *  · `/api/files/xxx.png` —— 用户上传（头像等）
 *  · `/assets/xxx.jpg`    —— 种子静态图
 * 两种都以 `/` 开头，统一补主机名（H5 同源时 ASSET_BASE 为空串，等于不加）。
 *
 * @param {string|null} url
 * @returns {string} 空值返回空串（调用方渲染占位）
 */
export function resolveImage(url) {
  if (!url || typeof url !== 'string') return ''
  if (ABSOLUTE.test(url)) return url
  if (url.charAt(0) === '/') return ASSET_BASE + url
  return url
}

const THUMBABLE = /\.(jpe?g|png|bmp)$/i
const UPLOADED = /\/api\/files\//

/**
 * 缩略图地址。规则与 Web 端 `frontend/src/utils/img.js` 保持一致：
 * 仅对「上传的图片」且扩展名可缩时改写为 `xxx_t.ext`；其余原样返回。
 *
 * ⚠️ 缩略图可能不存在（功能上线前上传的历史图），渲染时务必配 `@error` 兜底回退原图，
 *    见 `fallbackToOriginal()`。
 */
export function thumbUrl(url) {
  const full = resolveImage(url)
  if (!full) return ''
  if (ABSOLUTE.test(url)) return full
  if (!UPLOADED.test(full) || !THUMBABLE.test(full)) return full
  const at = full.lastIndexOf('.')
  if (at < 0) return full
  return `${full.slice(0, at)}_t${full.slice(at)}`
}

/** `image` 组件的 @error 兜底：缩略图 404 时回退原图，只回退一次。 */
export function fallbackToOriginal(e, original) {
  const el = e && e.target
  if (!el) return
  const ret = resolveImage(original)
  if (ret && el.src !== ret) el.src = ret
}

/* ==================== 时间 ==================== */

/** 宽松解析 `2026-09-13T14:14:13`（后端不带时区，手动解析避开 iOS 的兼容坑）。 */
export function parseDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  const m = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2}):(\d{1,2})/)
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  }
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / YYYY-MM-DD */
export function formatTime(value) {
  const d = parseDate(value)
  if (!d) return ''
  const diff = Date.now() - d.getTime()
  const min = 60 * 1000
  const hour = 60 * min
  const day = 24 * hour

  if (diff < 0) return formatDate(d)
  if (diff < min) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return formatDate(d)
}

/** YYYY-MM-DD */
export function formatDate(value) {
  const d = parseDate(value)
  if (!d) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* ==================== 游戏首字色块 ==================== */

/**
 * 🚨 实测：线上**全部 18 款游戏的 `cover` 都是 null**，帖子封面也全部为空
 *   （只有用户头像有图）。所以游戏卡不能用「等图片加载」的思路，
 *   一律走「首字 + 渐变色块」，颜色按 id 稳定取模，保证同一游戏每次颜色一致。
 */
const TILE_THEMES = [
  { bg: '#3a3350', fg: '#cbbdff' }, // 紫
  { bg: '#2d4a45', fg: '#7fe3cd' }, // 青
  { bg: '#4a3d2d', fg: '#f0c07a' }, // 橙
  { bg: '#2d3a4a', fg: '#8fbdf0' } // 蓝
]

/**
 * @param {{id?:number, name?:string}} game
 * @returns {{letter:string, bg:string, fg:string}}
 */
export function gameTile(game = {}) {
  const name = game.name || '?'
  // 取首字：中文取第一个字，英文取首字母大写
  const letter = /[a-zA-Z]/.test(name.charAt(0)) ? name.charAt(0).toUpperCase() : name.charAt(0)
  const theme = TILE_THEMES[Math.abs(Number(game.id) || 0) % TILE_THEMES.length]
  return { letter, bg: theme.bg, fg: theme.fg }
}

/** 数字缩写：1234 → 1.2k，避免长数字把布局撑破 */
export function shortNumber(n) {
  const v = Number(n) || 0
  if (v < 1000) return String(v)
  if (v < 10000) return `${(v / 1000).toFixed(1)}k`
  return `${(v / 10000).toFixed(1)}w`
}

/**
 * 图片 URL 工具（9-10 性能优化）。
 *
 * 后端上传时对 jpg/jpeg/png/bmp 会额外生成一张缩略图，命名规则为「主图名去掉扩展名 + _t + 扩展名」：
 *   主图   /api/files/ab12cd.jpg
 *   缩略图 /api/files/ab12cd_t.jpg
 * 仅对上传接口（/api/files/）返回的图片生效；GIF / WEBP 及种子静态图不生成缩略图，直接返回原图避免 404。
 *
 * 用法：`<img :src="thumbUrl(post.cover)" @error="onImgError" />`
 * 注意：务必配 @error 兜底回退原图 —— 历史图片（本功能上线前上传的）没有缩略图。
 */

/** 有缩略图的扩展名。 */
const THUMBABLE = /\.(jpe?g|png|bmp)$/i
/** 相对路径 / 外链 / data: 一律原样返回，不做拼接。 */
const ABSOLUTE = /^(https?:)?\/\/|^data:|^blob:/i
/**
 * 只对「用户上传」的图片走缩略图：必须是后端上传接口返回的 URL。
 * 种子数据里的静态图片（/assets/games/*.jpg 等）没有缩略图，改写会白白 404。
 */
const UPLOADED = /\/api\/files\//

/**
 * 由主图 URL 推导缩略图 URL；不可推导时返回原图。
 * @param {string} url 主图 URL（如 /api/files/ab12cd.jpg）
 * @returns {string} 缩略图 URL（如 /api/files/ab12cd_t.jpg），或原 URL
 */
export function thumbUrl(url) {
  if (!url || typeof url !== 'string') return url || ''
  if (ABSOLUTE.test(url)) return url
  if (!UPLOADED.test(url)) return url
  if (!THUMBABLE.test(url)) return url
  const at = url.lastIndexOf('.')
  if (at < 0) return url
  return `${url.slice(0, at)}_t${url.slice(at)}`
}

/**
 * img 的 onerror 兜底：缩略图不存在（历史图 / 生成失败）时回退加载原图，只回退一次。
 * @param {Event} e error 事件
 * @param {string} [original] 原图 URL；不传则从 src 反推（去掉 _t）
 */
export function fallbackToOriginal(e, original) {
  const img = e?.target
  if (!img || img.dataset.thumbFallback === '1') return
  img.dataset.thumbFallback = '1'
  const ret = original || (typeof img.src === 'string' ? img.src.replace(/(_t)(\.[a-z0-9]+)$/i, '$2') : '')
  if (ret && ret !== img.src) img.src = ret
}

/**
 * JWT 有效期工具（9-10 token 滑动续签）。
 *
 * 只做「读」：解析 token 的 exp，用于判断是否需要提前续签。
 * 不校验签名（前端无从校验，也不该校验）——签名校验始终由后端完成。
 */

/** 续签阈值：剩余有效期低于该值时触发滑动续签。 */
export const RENEW_THRESHOLD_MS = 30 * 60 * 1000

/**
 * 解析 JWT 的 payload。
 * @param {string} token
 * @returns {object|null} payload，解析失败返回 null
 */
export function decodeJwt(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    // base64url → base64；补足 padding
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
    const json = decodeURIComponent(
      atob(b64 + pad)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )
    return JSON.parse(json)
  } catch (_) {
    return null
  }
}

/**
 * 距离过期还剩多少毫秒。
 * @param {string} token
 * @returns {number} 剩余毫秒；无法解析时返回 0（视作已过期，交由后续逻辑兜底）
 */
export function expiresInMs(token) {
  const payload = decodeJwt(token)
  if (!payload || !payload.exp) return 0
  return payload.exp * 1000 - Date.now()
}

/**
 * 是否已到需要续签的时机（默认剩余 < 30 分钟）。
 * @param {string} token
 * @param {number} [threshold] 阈值毫秒
 */
export function isExpiringSoon(token, threshold = RENEW_THRESHOLD_MS) {
  return expiresInMs(token) < threshold
}

/** token 是否已经过期。 */
export function isExpired(token) {
  return expiresInMs(token) <= 0
}

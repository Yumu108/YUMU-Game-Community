// 身份徽章工具：把后端返回的 badge / badgeText / moderatorGameNames 转成展示文本 + tooltip
//
// 优化点：1.2 起版主按 (游戏, 板块) 精确授权，单一"版主"徽章在非负责游戏板块
// 容易让读者误以为是该游戏版主。这里把负责游戏名拼到徽章里，并配 tooltip 列完整。

const BADGE_TEXT = {
  ADMIN: '管理员',
  MODERATOR: '版主',
  SUB_MODERATOR: '子板主'
}

/**
 * 主徽章文本（含负责游戏前缀）
 * @param {string} code ADMIN/MODERATOR/SUB_MODERATOR/null
 * @param {string[]} [gameNames] 该用户负责的游戏名（按热度/sort 排序）
 * @returns {string}
 */
export function getBadgeText(code, gameNames) {
  const base = BADGE_TEXT[code] || ''
  if (code === 'MODERATOR' && Array.isArray(gameNames) && gameNames.length > 0) {
    // 例：「版主 · 三角洲行动」。超过 1 个时主标签只显示第一个，剩余放 tooltip。
    const extra = gameNames.length - 1
    const tip = extra > 0 ? ` (+${extra})` : ''
    return `${base} · ${gameNames[0]}${tip}`
  }
  return base
}

/**
 * tooltip 文本
 * - ADMIN：无
 * - MODERATOR：负责游戏列表（全部）；负责游戏为空时提示「暂无负责游戏」
 * @param {string} code
 * @param {string[]} [gameNames]
 * @returns {string}
 */
export function getBadgeTooltip(code, gameNames) {
  if (code !== 'MODERATOR') return ''
  if (!Array.isArray(gameNames) || gameNames.length === 0) return '当前账号尚未分配负责游戏'
  if (gameNames.length === 1) return `负责游戏：${gameNames[0]}`
  return `负责游戏（${gameNames.length} 个）：${gameNames.join('、')}`
}

/**
 * 徽章 el-tag 类型（color）。
 */
export function getBadgeClass(code) {
  return {
    ADMIN: 'badge-admin',
    MODERATOR: 'badge-mod',
    SUB_MODERATOR: 'badge-sub'
  }[code] || ''
}
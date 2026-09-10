/**
 * 1.2 起固定的六种板块分类（与后端 board 表 id 1-6 对齐）。
 * 取消子版块机制，左侧导航与发帖板块均使用此常量。
 */
export const FIXED_BOARDS = [
  { id: 1, key: 'guide', name: '攻略心得', emoji: '📖', desc: '通关攻略、阵容搭配、数值解析' },
  { id: 2, key: 'roast', name: '游戏吐槽', emoji: '😜', desc: '槽点、迷惑设计、实名吐槽' },
  { id: 3, key: 'teamup', name: '组队大厅', emoji: '🤝', desc: '召集队友、开黑组队、约战' },
  { id: 4, key: 'news', name: '资讯速递', emoji: '📰', desc: '版本更新、活动公告、官方情报' },
  { id: 5, key: 'fan', name: '二次创作', emoji: '🎨', desc: '同人图、MAD、Cos、脑洞二创' },
  { id: 6, key: 'other', name: '其他', emoji: '📦', desc: '不属于以上分类的杂谈' }
]

export function findBoard(id) {
  return FIXED_BOARDS.find((b) => b.id === Number(id)) || null
}

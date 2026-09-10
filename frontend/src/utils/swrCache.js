// ============================================================
// 列表快照缓存（stale-while-revalidate）—— 路由跳转丝滑化的核心
// ------------------------------------------------------------
// 问题：每次路由跳转组件重建、列表从零请求，期间闪 ~0.5s 骨架屏。
// 方案：离开页面前请求过的列表在这里留一份快照；跳回来时先用快照
//       立即渲染（0 等待、不闪骨架），60s 内视为新鲜直接不请求，
//       过期则后台静默刷新，回来后无感替换。
// 缓存键必须包含所有影响结果的参数（板块/排序/游戏过滤/页码/Tab）。
// ============================================================

const TTL = 60 * 1000
const MAX_ENTRIES = 60 // 防内存无限增长（列表对象很小，60 条足够）

const store = new Map()

export function getSnap(key) {
  const hit = store.get(key)
  if (!hit) return null
  // 每次访问挪到末尾，天然 LRU
  store.delete(key)
  store.set(key, hit)
  return { data: hit.data, fresh: Date.now() - hit.ts < TTL }
}

export function setSnap(key, data) {
  if (store.size >= MAX_ENTRIES) {
    // 淘汰最旧（Map 迭代顺序即插入顺序，第一个键最旧）
    const oldest = store.keys().next().value
    store.delete(oldest)
  }
  store.set(key, { data, ts: Date.now() })
}

/** 发帖 / 删帖 / 审核等写操作后调用，避免列表展示过期数据 */
export function clearAllSnaps(prefix) {
  if (!prefix) {
    store.clear()
    return
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

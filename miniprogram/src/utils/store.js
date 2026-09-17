/**
 * 本地存储 —— 收藏与浏览历史。
 *
 * 第一期**不依赖登录**：数据全在 `uni.setStorageSync`，换设备会丢，
 * 但换来「零登录成本、打开即用」。等接入登录后可平滑升级为
 * 「本地镜像 + 服务端 `/posts/{id}/favorite` 双写」。
 */
import { STORAGE_KEYS } from '../api/config'

const MAX_HISTORY = 50
const MAX_FAVORITES = 200

function read(key, fallback) {
  try {
    const v = uni.getStorageSync(key)
    return v || fallback
  } catch (e) {
    return fallback
  }
}

function write(key, value) {
  try {
    uni.setStorageSync(key, value)
  } catch (e) {
    /* 存储满/失败不阻断 */
  }
}

/* ==================== 浏览历史 ==================== */

export function getHistory() {
  const list = read(STORAGE_KEYS.HISTORY, [])
  return Array.isArray(list) ? list : []
}

/**
 * 记录一次浏览（去重后置顶）。
 * @param {{id:number,title:string,boardName?:string,gameName?:string}} post
 */
export function addHistory(post) {
  if (!post || !post.id) return
  const item = {
    id: post.id,
    title: post.title || '',
    boardName: post.boardName || '',
    gameName: post.gameName || '',
    at: Date.now()
  }
  const list = getHistory().filter((x) => x.id !== item.id)
  list.unshift(item)
  write(STORAGE_KEYS.HISTORY, list.slice(0, MAX_HISTORY))
}

export function clearHistory() {
  write(STORAGE_KEYS.HISTORY, [])
}

/* ==================== 收藏 ==================== */

export function getFavorites() {
  const list = read(STORAGE_KEYS.FAVORITES, [])
  return Array.isArray(list) ? list : []
}

export function isFavorite(id) {
  return getFavorites().some((x) => x.id === id)
}

/**
 * 切换收藏状态。
 * @returns {boolean} 切换后是否处于「已收藏」
 */
export function toggleFavorite(post) {
  if (!post || !post.id) return false
  const list = getFavorites()
  const idx = list.findIndex((x) => x.id === post.id)
  if (idx >= 0) {
    list.splice(idx, 1)
    write(STORAGE_KEYS.FAVORITES, list)
    return false
  }
  list.unshift({
    id: post.id,
    title: post.title || '',
    boardName: post.boardName || '',
    gameName: post.gameName || '',
    likeCount: post.likeCount || 0,
    at: Date.now()
  })
  write(STORAGE_KEYS.FAVORITES, list.slice(0, MAX_FAVORITES))
  return true
}

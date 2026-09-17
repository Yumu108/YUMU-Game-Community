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
const MAX_LIKES = 200

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
 *
 * 🚨 2026-09-17 修：原来超上限时 `slice(0, MAX)` **静默丢弃最旧的一条** ——
 *   用户点了「收藏」，提示「已加入收藏」，但另一条悄无声息地没了。
 *   这与本项目的三条工程约定同族（故障/损失被伪装成正常）。
 *   现在改为：**不再静默丢弃**，写满时不动原有数据，把 `full: true` 交回调用方去提示。
 *
 * @returns {{on:boolean, full:boolean}} on=切换后是否已收藏；full=因写满而未能收藏
 */
export function toggleFavorite(post) {
  if (!post || !post.id) return { on: false, full: false }
  const list = getFavorites()
  const idx = list.findIndex((x) => x.id === post.id)
  if (idx >= 0) {
    list.splice(idx, 1)
    write(STORAGE_KEYS.FAVORITES, list)
    return { on: false, full: false }
  }
  if (list.length >= MAX_FAVORITES) return { on: false, full: true }
  list.unshift(toBrief(post))
  write(STORAGE_KEYS.FAVORITES, list)
  return { on: true, full: false }
}

/* ==================== 点赞（本机记录） ==================== */

/**
 * 点赞 —— **仅存本机，不上传**。
 *
 * 🚨 为什么不做「真点赞」：后端 `POST /posts/{id}/like` 落在
 *   `SecurityConfig` 的 `.anyRequest().authenticated()` 里，**必须有登录态**；
 *   而本端定位是零登录的内容浏览端（见 docs/方案设计.md §二）。
 *   所以这里与「收藏」采用**同一套本地模型**：可点亮、可回看、可取消，
 *   但**不会**去篡改帖子真实的 `likeCount`（页面展示的仍是服务端数字）。
 *   如实标注「本机记录」，不做假按钮、不虚增数据。
 */
export function getLikes() {
  const list = read(STORAGE_KEYS.LIKES, [])
  return Array.isArray(list) ? list : []
}

export function isLiked(id) {
  return getLikes().some((x) => x.id === id)
}

/**
 * 切换点赞。
 * @returns {{on:boolean, full:boolean}} 语义同 toggleFavorite
 */
export function toggleLike(post) {
  if (!post || !post.id) return { on: false, full: false }
  const list = getLikes()
  const idx = list.findIndex((x) => x.id === post.id)
  if (idx >= 0) {
    list.splice(idx, 1)
    write(STORAGE_KEYS.LIKES, list)
    return { on: false, full: false }
  }
  if (list.length >= MAX_LIKES) return { on: false, full: true }
  list.unshift(toBrief(post))
  write(STORAGE_KEYS.LIKES, list)
  return { on: true, full: false }
}

export function clearLikes() {
  write(STORAGE_KEYS.LIKES, [])
}

/* ==================== 登录会话 ==================== */

/**
 * 登录态（2026-09-17 接入）。账号体系与主站**完全通用**：
 * 同一套 user 表、同一个 `POST /auth/login`，token 也是同一个 JWT。
 *
 * ⚠️ token 的清理由 `api/request.js#clearSession` 收口（401 时同步清 user），
 *    这里只提供读写视图，不要在页面里绕过它直接清 token。
 */

/** @returns {{id:number,username:string,nickname:string,avatar?:string}|null} */
export function getUser() {
  const u = read(STORAGE_KEYS.USER, null)
  return u && u.id ? u : null
}

/** 登录成功后写入（结构与主站登录响应的 `data.user` 对齐） */
export function setUser(user) {
  if (!user || !user.id) return
  write(STORAGE_KEYS.USER, {
    id: user.id,
    username: user.username || '',
    nickname: user.nickname || user.username || '',
    avatar: user.avatar || ''
  })
}

export function clearUser() {
  try {
    uni.removeStorageSync(STORAGE_KEYS.USER)
  } catch (e) {
    /* 忽略 */
  }
}

/* ==================== 举报（本机防重复） ==================== */

/**
 * 已举报记录 —— 只存本机帖子 id，用于把「举报」入口置灰，防止重复提交。
 * 服务端还有第二道防线（同一帖存在待处理举报时后端会拒绝），这里只是体验层。
 */
export function isReported(id) {
  return getReported().includes(id)
}

export function markReported(id) {
  if (!id) return
  const list = getReported()
  if (!list.includes(id)) {
    list.unshift(id)
    write(STORAGE_KEYS.REPORTED, list.slice(0, 200))
  }
}

function getReported() {
  const list = read(STORAGE_KEYS.REPORTED, [])
  return Array.isArray(list) ? list : []
}

/** 本地记录只留「能在列表里显示出来」的最小字段集 */
function toBrief(post) {
  return {
    id: post.id,
    title: post.title || '',
    boardName: post.boardName || '',
    gameName: post.gameName || '',
    likeCount: post.likeCount || 0,
    at: Date.now()
  }
}

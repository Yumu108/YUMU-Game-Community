/**
 * 本机存储 —— **浏览历史 / 登录会话 / 举报去重标记**。
 *
 * 🚨 2026-09-21 口径变更（重要，别再按老理解读这里）：
 *   **收藏与点赞不再走本机**。原先它们和浏览历史一样存在 `uni.setStorageSync`
 *   （零登录也能点、换了设备就丢、还**不会**计入帖子真实的 `likeCount`）。
 *   现在改为「登录后才能用、数据落在服务端」：
 *     · 点赞  `POST /posts/{id}/like`      → `{liked, likeCount}`（真实计入赞数）
 *     · 收藏  `POST /posts/{id}/favorite`  → `{favorited}`
 *     · 未登录点击 → `utils/authGate.js#requireLogin` 提示 + 跳登录页
 *   列表侧则由端内索引给出（索引记录带 `liked` / `favorited`，见 utils/guideIndex.js）。
 *   旧的 `yumu_favorites` / `yumu_likes` 两个键**已废弃**，不再读写。
 *
 *   为什么这个模型站不住：点赞/收藏天然是「账号资产」，走本机就等于
 *   既不真实（不改服务端数据）、又不可靠（换设备即失）。登录接入后（9-17）它的
 *   存在理由已经消失，留着只会让人以为「登录了还是只在这台设备」。
 */
import { STORAGE_KEYS } from '../api/config'

const MAX_HISTORY = 50

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

/* ==================== 浏览历史（本机，游客也可用） ==================== */

export function getHistory() {
  const list = read(STORAGE_KEYS.HISTORY, [])
  return Array.isArray(list) ? list : []
}

/**
 * 记录一次浏览（去重后置顶）。
 *
 * 📌 这是**唯一对游客开放**的写入动作 —— 它不绑身份、不影响服务端数据，
 *   属于「本机便利功能」，所以不加登录门禁（用户 2026-09-21 明确口径）。
 *
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

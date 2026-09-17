/**
 * 请求层 —— 复刻 Web 端 `frontend/src/api/request.js` 的核心语义，但落到 `uni.request`。
 *
 * 保留的关键行为：
 *  ① 自动注入 `Authorization: Bearer <token>`；
 *  ② **HTTP 状态码恒为 200**，成败一律看响应体的 `code` 字段（后端统一 Result 包装）；
 *  ③ `code === 401` → 清登录态 + 提示（对应 Web 端「登录已过期」分支）。
 *
 * 有意简化的部分（小程序端第一期不走登录）：
 *  · 不做 token 滑动续签 / 401 重试 —— 收藏先走本地，等接入登录时再补。
 */
import { API_BASE, STORAGE_KEYS } from './config'

/* ---------------- token 存取 ---------------- */

export function getToken() {
  try {
    return uni.getStorageSync(STORAGE_KEYS.TOKEN) || ''
  } catch (e) {
    return ''
  }
}

export function setToken(token) {
  try {
    if (token) uni.setStorageSync(STORAGE_KEYS.TOKEN, token)
    else uni.removeStorageSync(STORAGE_KEYS.TOKEN)
  } catch (e) {
    /* 存储失败不阻断主流程 */
  }
}

export function clearToken() {
  setToken('')
}

/* ---------------- 提示 ---------------- */

function toast(message) {
  uni.showToast({ title: message || '请求失败', icon: 'none', duration: 2000 })
}

/* ---------------- 核心请求 ---------------- */

/**
 * @param {object}   opt
 * @param {string}   opt.url      以 `/` 开头的路径（如 `/posts`）
 * @param {string}  [opt.method]  默认 GET
 * @param {object}  [opt.data]    query（GET）或 body（POST）
 * @param {boolean} [opt.silent]  静默模式：失败不弹 toast（用于首屏并发拉取）
 * @returns {Promise<any>} 直接 resolve 出 `data`（已剥掉 Result 外壳）
 */
export function request(opt = {}) {
  const { url, method = 'GET', data = {}, silent = false } = opt

  return new Promise((resolve, reject) => {
    const token = getToken()
    const header = { 'Content-Type': 'application/json' }
    if (token) header.Authorization = `Bearer ${token}`

    uni.request({
      url: API_BASE + url,
      method,
      data,
      header,
      timeout: 15000,
      success: (res) => {
        // 安全入口（未带 token / token 失效）会直接返回 HTTP 401
        if (res.statusCode === 401) {
          clearToken()
          if (!silent) toast('登录已过期，请重新登录')
          return reject(new Error('unauthorized'))
        }

        const body = res.data

        // 非 Result 包装的响应（如直出文件流）原样返回
        if (!body || typeof body.code !== 'number') return resolve(body)

        if (body.code === 200) return resolve(body.data)

        if (body.code === 401) {
          clearToken()
          if (!silent) toast(body.message || '登录已过期，请重新登录')
          return reject(new Error(body.message || 'unauthorized'))
        }

        if (!silent) toast(body.message || '请求失败，请稍后重试')
        reject(new Error(body.message || '请求失败'))
      },
      fail: (err) => {
        if (!silent) toast('网络异常，请稍后重试')
        reject(err)
      }
    })
  })
}

export const get = (url, data, opt) => request({ url, method: 'GET', data, ...opt })
export const post = (url, data, opt) => request({ url, method: 'POST', data, ...opt })

export default request

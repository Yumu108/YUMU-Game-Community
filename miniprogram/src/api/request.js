/**
 * 请求层 —— 复刻 Web 端 `frontend/src/api/request.js` 的核心语义，但落到 `uni.request`。
 *
 * 保留的关键行为：
 *  ① 自动注入 `Authorization: Bearer <token>`；
 *  ② **HTTP 状态码恒为 200**，成败一律看响应体的 `code` 字段（后端统一 Result 包装）；
 *  ②' GET 的 query 统一过 `cleanParams`（丢 `undefined` / `null`）—— 见下方 `payload`，
 *      `?platform=undefined` 会被后端当成真筛选、静默返回空集，属「看着成功的空响应」；
 *  ③ 401 分三类处理（**与主站 `classify401` 口径一致**，2026-09-17 接入登录时补齐）：
 *     · silent —— `/auth/refresh`、`/auth/logout`：静默失败，绝不弹「登录已过期」刷屏；
 *     · toast  —— `/auth/login`、`/auth/register`、`/auth/email-code`、`/auth/reset-password`：
 *                 登录入口类，把**后端原文**弹给用户（如「账号或密码错误」）；
 *     · unauth —— 其余业务请求：先尝试**续签一次并重放**（单飞），失败才清登录态。
 *
 * 滑动续签（对齐主站两段式里的「被动段」）：
 *  · 后端 access token 有效期 2h，`POST /auth/refresh` 用旧 token 换新 token（旧 jti 立即拉黑）；
 *  · 后端会作废旧 token ⇒ 并发请求必须**共用同一个续签 Promise**（single-flight），
 *    否则后发的续签会把前面刚拿到的新 token 作废（主站注释原话）。
 *  · 与主站的差异：不做「临期 <30min 主动续签」（需要解析 JWT exp，小程序端先省略），
 *    活跃会话里收到 401 会自动续签重放，用户无感；闲置超 2h 才需要重新登录。
 */
import { API_BASE, STORAGE_KEYS } from './config'
import { cleanParams } from '../utils/apiGuard'

/* ---------------- token / 会话存取 ---------------- */

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

/** 清登录态：token + 用户信息一起清（session 收口） */
export function clearSession() {
  setToken('')
  try {
    uni.removeStorageSync(STORAGE_KEYS.USER)
  } catch (e) {
    /* 同上 */
  }
}

/* ---------------- 401 三分类（对齐主站 classify401） ---------------- */

const SILENT_401 = /\/auth\/(refresh|logout)/
const TOAST_401 = /\/auth\/(login|register|email-code|reset-password)/

/** @returns {'silent'|'toast'|'unauth'} */
function classify401(url = '') {
  if (SILENT_401.test(url)) return 'silent'
  if (TOAST_401.test(url)) return 'toast'
  return 'unauth'
}

/* ---------------- 续签单飞 ---------------- */

let refreshing = null

/**
 * 用当前 token 换新 token。并发调用共享同一个 Promise（单飞）。
 * @returns {Promise<boolean>} 是否续签成功
 */
function refreshOnce() {
  if (refreshing) return refreshing
  refreshing = new Promise((resolve) => {
    const token = getToken()
    if (!token) return resolve(false)
    uni.request({
      url: API_BASE + '/auth/refresh',
      method: 'POST',
      data: {},
      header: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      timeout: 15000,
      success: (res) => {
        const body = res.data
        if (res.statusCode === 200 && body && body.code === 200 && body.data && body.data.token) {
          setToken(body.data.token)
          resolve(true)
        } else {
          resolve(false)
        }
      },
      fail: () => resolve(false)
    })
  }).finally(() => {
    refreshing = null
  })
  return refreshing
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
 * @param {boolean} [opt._retried] 内部标记：401 续签重放后的第二次尝试，不再续签
 * @returns {Promise<any>} 直接 resolve 出 `data`（已剥掉 Result 外壳）
 */
export function request(opt = {}) {
  const { url, method = 'GET', data = {}, silent = false, _retried = false } = opt

  return new Promise((resolve, reject) => {
    const token = getToken()
    const header = { 'Content-Type': 'application/json' }
    if (token) header.Authorization = `Bearer ${token}`

    // 🚨 GET 的 query 必须先过一遍 `cleanParams`（丢 undefined / null）：
    //    各运行时对 undefined 的序列化行为并不一致（H5 变空串、小程序可能变字符串 "undefined"），
    //    而本后端会把 `platform=undefined` 当成**真实筛选值** ⇒ 一条都不匹配却仍返回 200/total:0。
    //    这种「看着成功的空响应」正是「平台分类全 0」事故的入口，见 utils/apiGuard.js 头部复盘。
    const payload = method === 'GET' ? cleanParams(data) : data

    uni.request({
      url: API_BASE + url,
      method,
      data: payload,
      header,
      timeout: 15000,
      success: async (res) => {
        // 安全入口（未带 token / token 失效）会直接返回 HTTP 401
        if (res.statusCode === 401) {
          return handle401(url, silent, _retried, resolve, reject, () =>
            request({ ...opt, _retried: true })
          )
        }

        const body = res.data

        // 非 Result 包装的响应（如直出文件流）原样返回
        if (!body || typeof body.code !== 'number') return resolve(body)

        if (body.code === 200) return resolve(body.data)

        if (body.code === 401) {
          return handle401(url, silent, _retried, resolve, reject, () =>
            request({ ...opt, _retried: true })
          , body.message)
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

/**
 * 401 统一处理（HTTP 401 与业务 code 401 两路都汇到这里）。
 * @param {string} url 原请求路径
 * @param {boolean} silent 静默模式
 * @param {boolean} retried 是否已是重放请求
 * @param {(v:any)=>void} resolve
 * @param {(e:Error)=>void} reject
 * @param {()=>Promise<any>} replay 续签成功后重放原请求
 * @param {string} [msg] 后端返回的 message（toast 类直接展示）
 */
async function handle401(url, silent, retried, resolve, reject, replay, msg) {
  const kind = classify401(url)
  if (kind === 'silent') {
    // refresh/logout 自己的 401：静默失败，由调用方决定下一步
    return reject(new Error(msg || 'unauthorized'))
  }
  if (kind === 'toast') {
    // 登录入口类：后端原文就是给用户看的（如「账号或密码错误」），原样弹
    if (!silent) toast(msg || '请求失败，请稍后重试')
    return reject(new Error(msg || 'unauthorized'))
  }
  // unauth：业务请求的登录态失效 —— 续签一次并重放；已是重放则真的登出
  if (!retried && (await refreshOnce())) {
    try {
      return resolve(await replay())
    } catch (e) {
      return reject(e)
    }
  }
  clearSession()
  if (!silent) toast(msg || '登录已过期，请重新登录')
  reject(new Error(msg || 'unauthorized'))
}

export const get = (url, data, opt) => request({ url, method: 'GET', data, ...opt })
export const post = (url, data, opt) => request({ url, method: 'POST', data, ...opt })
/**
 * PUT —— 2026-09-26 新增（端内「用户权限管理」需要）。
 * 后端 `/admin/users/{id}/roles` 与 `/moderator-boards` 都是 `@PutMapping`
 * 且要求 `@RequestBody`（含 `@Valid`），所以**必须**走 PUT + body。
 *
 * ⚠️ 别图省事用 POST 顶替：Spring MVC 对方法不匹配返回 405，
 *    而请求层会把 405 当普通业务失败 toast 出来，报错信息是「请求失败」之类，
 *    根本看不出是方法错了（同 §「`?key=value` 传了没效果」那类静默坑）。
 */
export const put = (url, data, opt) => request({ url, method: 'PUT', data, ...opt })

export default request

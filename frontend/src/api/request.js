import axios from 'axios'
import { useUserStore } from '@/store'
import { isExpiringSoon } from '@/utils/tokenAuth'

const request = axios.create({
  baseURL: '/api',
  timeout: 10000
})

/** 认证相关接口（登录/注册/续签/登出）：不参与"临期续签 / 401 重试"，避免递归。 */
const AUTH_API = /^\/auth\//

/**
 * 9-10 token 滑动续签（两段式）。
 *
 * 背景：A3 把 access token 从 24h 缩到 2h 后，用户每 2 小时被强制重登一次。
 * 现在改为「滑动续签」——只要用户还在用，token 就自动续期；闲置超过 2h 才真正过期。
 *
 * ① 请求前（主动）：发现 token 剩余有效期 < 30 分钟 → 先续签再发请求，用户无感。
 * ② 响应后（被动）：仍收到 401 → 尝试续签一次并用新 token 重放原请求；再失败才登出。
 *
 * 后端每次续签都会把旧 jti 拉黑（轮换），所以必须"单飞"：
 * 并发请求共用同一个续签 Promise（见 store.refreshToken），否则后发的续签会把前面的新 token 作废。
 */

/** 判断该请求是否要跳过续签逻辑。 */
function skipRenew(config) {
  return Boolean(config && (config._skipRenew || config._retried))
}

/** 续签成功后重放原请求；失败返回 null（交由调用方登出）。 */
async function renewAndRetry(config) {
  if (!config || config._retried || config._skipRenew) return null
  config._retried = true
  const userStore = useUserStore()

  const replayWith = async (token) => {
    config.headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` }
    return request(config)
  }

  // 1) 并发/多标签页：别人可能刚续签过 → 直接用最新 token 重放，自己不再轮换一次
  //    （否则会把对方刚拿到的 token 再次拉黑，形成"轮换风暴"）
  const stored = localStorage.getItem('token')
  if (stored && stored !== userStore.token) {
    userStore.setToken(stored)
    try {
      return await replayWith(stored)
    } catch (_) {
      /* 该 token 也不可用 → 继续走下面的自行续签 */
    }
  }

  // 2) 自己续签
  try {
    const token = await userStore.refreshToken()
    return await replayWith(token)
  } catch (_) {
    // 3) 续签失败：可能 token 恰好被并发流程轮换掉了 → 最后再试一次"最新 token"
    const latest = localStorage.getItem('token')
    if (latest && latest !== userStore.token) {
      userStore.setToken(latest)
      try {
        return await replayWith(latest)
      } catch (_) {
        /* 放弃，交由调用方登出 */
      }
    }
    return null
  }
}

/** 401 兜底：先尝试续签重放，不行才清登录态并提示。 */
async function handleUnauthorized(config) {
  const retried = await renewAndRetry(config)
  if (retried) return retried
  const userStore = useUserStore()
  ElMessage.error('登录已过期，请重新登录')
  userStore.clearLocalAuth()
  return null
}

request.interceptors.request.use(
  async (config) => {
    const userStore = useUserStore()
    const url = config.url || ''
    // 主动续签：临期就先换新 token（失败不阻断，交给后面的 401 分支兜底）
    if (!skipRenew(config) && !AUTH_API.test(url) && userStore.token && isExpiringSoon(userStore.token)) {
      try {
        await userStore.refreshToken()
      } catch (_) {
        /* ignore：真失效时下面会收到 401 */
      }
    }
    if (userStore.token) {
      config.headers.Authorization = `Bearer ${userStore.token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

request.interceptors.response.use(
  async (response) => {
    const data = response.data
    // 后端统一返回 Result{code,message,data}，HTTP 恒为 200；
    // 业务错误也包在 body.code 里，这里一并 reject 并弹错，避免调用方静默失败。
    if (data && typeof data.code === 'number' && data.code !== 200) {
      if (data.code === 401) {
        const retried = await handleUnauthorized(response.config)
        if (retried) return retried
      } else {
        ElMessage.error(data.message || '请求失败，请稍后重试')
      }
      return Promise.reject(new Error(data.message || '请求失败'))
    }
    return data
  },
  async (error) => {
    // 服务端安全入口（未带 token / token 无效或已过期）会直接返回 HTTP 401
    if (error.response?.status === 401 && !error.config?._skipRenew) {
      const retried = await handleUnauthorized(error.config)
      if (retried) return retried
      return Promise.reject(error)
    }
    const msg = error.response?.data?.message || '请求失败，请稍后重试'
    ElMessage.error(msg)
    return Promise.reject(error)
  }
)

export default request

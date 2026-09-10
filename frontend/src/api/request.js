import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/store'

const request = axios.create({
  baseURL: '/api',
  timeout: 10000
})

request.interceptors.request.use(
  (config) => {
    const userStore = useUserStore()
    if (userStore.token) {
      config.headers.Authorization = `Bearer ${userStore.token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

request.interceptors.response.use(
  (response) => {
    const data = response.data
    // 后端统一返回 Result{code,message,data}，HTTP 恒为 200；
    // 业务错误也包在 body.code 里，这里一并 reject 并弹错，避免调用方静默失败。
    if (data && typeof data.code === 'number' && data.code !== 200) {
      ElMessage.error(data.message || '请求失败，请稍后重试')
      if (data.code === 401) {
        const userStore = useUserStore()
        userStore.logout()
      }
      return Promise.reject(new Error(data.message || '请求失败'))
    }
    return data
  },
  (error) => {
    const msg = error.response?.data?.message || '请求失败，请稍后重试'
    ElMessage.error(msg)
    if (error.response?.status === 401) {
      const userStore = useUserStore()
      userStore.logout()
    }
    return Promise.reject(error)
  }
)

export default request

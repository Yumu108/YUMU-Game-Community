/**
 * 认证接口 —— 与主站**完全同一套后端**（`/auth/*`），账号通用、注册方式通用。
 *
 * 契约（2026-09-17 从后端 `AuthController` / `AuthServiceImpl` 核对）：
 *  · POST /auth/login      {username(账号id 或邮箱), password} → {token, user}
 *                          限频：同账号 5 次/分、同 IP 20 次/分；密码错误 = code 401
 *                          「账号或密码错误」（前端必须原样展示，别改成「登录过期」）
 *  · POST /auth/register   {username, password, email, emailCode, nickname?} → {token, user}
 *                          账号规则 `^[A-Za-z0-9_]{3,20}$`；邮箱必填 + 6 位验证码；
 *                          限频：同 IP 5 次/5 分钟
 *  · POST /auth/email-code {email, scene:'register'|'reset'}；同邮箱 60s 冷却
 *  · POST /auth/reset-password {email, emailCode, newPassword} → void
 *                          ⚠️ 防枚举：未注册邮箱同样返回成功（前端提示语不能写
 *                          「已发送到你的邮箱」，要对齐主站「若该邮箱已注册…」）
 *  · POST /auth/logout     入黑名单当前 token；未传 token 也返回 200
 *  · POST /auth/refresh    Bearer 旧 token → {token}（2h 滑动续签，旧 jti 拉黑）
 *
 * token 存取与 401 续签在 `api/request.js`（对齐主站 classify401 三分类）。
 */
import { get, post } from './request'

/** 登录（username 兼容账号id 与邮箱） */
export const login = ({ username, password }) =>
  post('/auth/login', { username, password })

/**
 * 注册。与主站一致：邮箱 + 验证码必填（生产环境）；
 * `nickname` 可选（不填后端用账号id 兜底）。
 */
export const register = ({ username, password, email, emailCode, nickname }) =>
  post('/auth/register', { username, password, email, emailCode, nickname })

/** 发送邮箱验证码（scene：'register' 注册 / 'reset' 忘记密码） */
export const sendEmailCode = (email, scene = 'register') =>
  post('/auth/email-code', { email, scene })

/**
 * 忘记密码：邮箱验证码重置密码（后端 `PasswordResetRequest`：email + emailCode + newPassword）。
 * 与主站一致：成功后**不自动登录**，回登录态让用户用新密码登。
 */
export const resetPassword = ({ email, emailCode, newPassword }) =>
  post('/auth/reset-password', { email, emailCode, newPassword })

/** 退出登录（后端把 token 入黑名单；失败不阻断前端清态） */
export const logout = () => post('/auth/logout', {})

/** 当前登录用户信息（GET /auth/me） */
export const fetchMe = () => get('/auth/me')

/**
 * 提交举报（targetType=1 帖子）。登录用户可用。
 * 主站「管理后台 → 举报处理」闭环：管理员/版主在 `GET /admin/reports` 看到。
 * @param {{targetId:number, reason:string}} p
 */
export const submitReport = ({ targetId, reason }) =>
  post('/reports', { targetType: 1, targetId, reason })

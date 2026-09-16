/**
 * 单条通知收口（9-16 用户反馈：右上角一次弹好几条，叠成又高又大的一片白，挡住页面）。
 *
 * 背景：ElementPlus 的 ElNotification 默认「来一条弹一条、垂直堆叠」，ws 推送在突然
 * 收到一串私信/通知时会一次叠出 4~5 张卡片 —— 实测 330×84 × 4 = 330×336px 的一大坨。
 *
 * 这里统一收口成三条规则：
 *   ① 屏幕上**任何时刻最多 1 条**   —— 弹新的之前先关掉上一条
 *   ② 极短时间内的突发**合并成一条** —— 200ms 窗口里只弹最后一条（否则会连闪好几次）
 *   ③ 同内容 1.5s 内**去重**        —— ws 断线重连后服务端重放，会推一模一样的消息
 *
 * 通知只是「提醒」；准确来源永远是右上角红点 + 通知/私信列表，所以合并不会丢信息。
 *
 * ⚠️ 样式：显式 import 通知组件的 CSS（ElementPlusResolver 只在**出现 ElNotification
 *    标识符的文件**里注入它）。本文件是 utils，不走 unplugin 的自动注入，必须自己带上，
 *    否则通知会变成没有样式的一堆裸文字。
 */
import { ElNotification } from 'element-plus'
import 'element-plus/es/components/notification/style/css'

const MERGE_MS = 200    // 突发合并窗口
const DEDUPE_MS = 1500  // 同内容去重窗口
const MAX_TEXT = 60     // 正文截断长度（私信可能几百字，不截会把卡片撑得很高）

/** 超长文本截断，避免单条通知被正文撑高 */
const clip = (s, n = MAX_TEXT) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

let current = null      // 当前屏幕上那条的句柄
let pending = null      // 合并窗口里待弹的
let pendingTimer = null
let lastKey = ''
let lastAt = 0

/**
 * 弹一条通知（保证屏幕上最多 1 条）
 * @param {object} opts 同 ElNotification 的入参；额外支持 `key` 指定去重键
 */
export function notifyOnce(opts = {}) {
  const { key = `${opts.title || ''}|${opts.message || ''}`, message, ...rest } = opts

  // ③ 同内容去重：ws 重连后重放会推出完全相同的消息
  if (key === lastKey && Date.now() - lastAt < DEDUPE_MS) return

  // ② 突发合并：窗口内后来的覆盖先来的，只保留最后一条
  pending = { key, message: clip(message), ...rest }
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    const p = pending
    pending = null
    if (!p) return

    lastKey = p.key
    lastAt = Date.now()

    // ① 关旧弹新：保证任何时刻屏幕上只有一条
    if (current) {
      try { current.close() } catch { /* 已经关掉了，忽略 */ }
      current = null
    }

    const { key: _ignored, ...payload } = p
    let handle
    handle = ElNotification({
      duration: 3000,
      ...payload,
      onClose: () => { if (current === handle) current = null }
    })
    current = handle
  }, MERGE_MS)
}

/** 立刻清掉当前通知（退出登录/切换账号时调用，避免残留上一个人的消息） */
export function closeNotify() {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
  pending = null
  if (current) {
    try { current.close() } catch { /* 忽略 */ }
    current = null
  }
}

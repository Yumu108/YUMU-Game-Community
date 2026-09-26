/**
 * AI 智能助手接口层 —— 流式对话（SSE）。
 *
 * 复用后端**现成**的 `POST /api/ai/chat`（`AiAssistantController`，
 * 由 `AiAssistantService` 代理 OpenAI 兼容大模型，默认 DeepSeek），
 * 与主站 `frontend/src/components/AiAssistant.vue` 走同一个端点、同一套事件协议。
 * 小程序端**不需要**任何后端改动。
 *
 * ┌ 为什么这段不能复用 `api/request.js` ────────────────────────
 * │ `request.js` 的整套语义建立在「后端统一 Result 包装 + HTTP 恒 200」之上，
 * │ 它会 `await` 完整响应体再剥壳。而 AI 回答是 **SSE 流**：必须边收边解析、
 * │ 边把增量交给页面，等收完再显示就失去了流式打字的意义。
 * │ ⇒ 这里单独实现，但仍遵循两条老规矩：
 * │   ① `conversationId` 由后端下发、前端只做转存（不自己造）；
 * │   ② 业务异常（限频 429 / 参数 400）后端返回的是**普通 JSON 而非 SSE**，
 * │      必须先判 `content-type`，否则直接读流会一条事件都解析不出来 ——
 * │      用户只看到一个**空白气泡**（主站注释里踩过这个坑，此处沿用同样的防护）。
 * └──────────────────────────────────────────────────────
 *
 * ⚠️ 端差异（用条件编译隔离，构建时只留一支）：
 *   · H5      —— `fetch` + `ReadableStream`，浏览器原生分块。
 *   · 小程序  —— `wx.request({ enableChunked: true })` + `onChunkReceived`。
 *               **低版本基础库没有这个能力**时自动降级：等 `success` 拿到完整
 *               响应体后一次性解析（功能不丢，只是没有逐字效果）。
 */
import { API_BASE } from './config'
import { createSseParser, createUtf8Decoder, dispatchEvent } from '../utils/aiProtocol'

/** 匿名用户标识的存储键（与主站同名；两端存储不共享，键名一致只为便于对照） */
const AI_UID_KEY = 'yumu_ai_uid'

/** 读超时：AI 回答可能带思维链，比普通接口慢得多，别用 request.js 的 15s */
const TIMEOUT = 60000

/**
 * 取（或生成）本机稳定的匿名标识。
 *
 * 为什么要它：后端用它做**会话隔离与限频**。登录用户传 uid 更好，
 * 但本端 AI 助手对游客开放（与主站一致），所以这里生成一个稳定随机串并持久化。
 * @returns {string}
 */
export function getAiUserId() {
  try {
    let v = uni.getStorageSync(AI_UID_KEY)
    if (!v) {
      v = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
      uni.setStorageSync(AI_UID_KEY, v)
    }
    return String(v)
  } catch (e) {
    // 存储不可用时退化为进程内随机串（会话级，不持久）——不阻断使用
    return 'anon-' + Math.random().toString(36).slice(2, 10)
  }
}

/* ==================== H5 ==================== */
// #ifdef H5
function runStream(payload, handlers, ctl) {
  return (async () => {
    let resp
    try {
      resp = await fetch(API_BASE + '/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(payload)
      })
    } catch (e) {
      handlers.onError('网络异常：' + ((e && e.message) || '连接失败'))
      return
    }

    // 先看类型：限频 429 / 参数 400 返回的是 JSON，不是 SSE 流
    const ctype = resp.headers.get('content-type') || ''
    if (ctype.indexOf('text/event-stream') === -1) {
      const data = await resp.json().catch(() => null)
      handlers.onError((data && data.message) || '请求失败（HTTP ' + resp.status + '）')
      return
    }

    const reader = resp.body.getReader()
    ctl.reader = reader
    const dec = createUtf8Decoder()
    const parser = createSseParser()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const text = dec(value)
        if (!text) continue
        for (const ev of parser(text)) dispatchEvent(ev, handlers)
      }
    } catch (e) {
      // 用户主动中断不算错误
      if (!ctl.aborted) handlers.onError('连接中断：' + ((e && e.message) || '未知原因'))
    } finally {
      if (typeof handlers.onEnd === 'function') handlers.onEnd()
    }
  })()
}
// #endif

/* ==================== 小程序 ==================== */
// #ifndef H5
function runStream(payload, handlers, ctl) {
  return new Promise((resolve) => {
    const dec = createUtf8Decoder()
    const parser = createSseParser()
    let streamed = false
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      if (typeof handlers.onEnd === 'function') handlers.onEnd()
      resolve()
    }

    // 🚨 直接用 `wx.request` 而不是 `uni.request`：`enableChunked` / `onChunkReceived`
    //    是微信特有的分块能力，经过 uni 的适配层转发有被丢掉的风险（丢了不会报错，
    //    只会静默退化成「等全部收完再一次性显示」，很难被发现）。
    const req = typeof wx !== 'undefined' && wx.request ? wx.request : uni.request

    const task = req({
      url: API_BASE + '/ai/chat',
      method: 'POST',
      header: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      data: payload,
      timeout: TIMEOUT,
      // 分块与完整两条路径都按 ArrayBuffer 取，交给自带的解码器统一还原文本
      enableChunked: true,
      responseType: 'arraybuffer',
      success: (res) => {
        if (streamed) return finish()
        // 降级路径：整段响应体已在 res.data 里
        let text = ''
        try {
          text = typeof res.data === 'string' ? res.data : dec(res.data)
        } catch (e) {
          text = ''
        }
        if (text) {
          const evs = parser(text)
          if (evs.length) {
            for (const ev of evs) dispatchEvent(ev, handlers)
            return finish()
          }
          // 不是 SSE ⇒ 大概率是 JSON 错误体（限频 / 参数）
          try {
            const j = JSON.parse(text)
            if (j && j.message) handlers.onError(j.message)
          } catch (e) {
            /* 真正无法识别的响应，静默结束 */
          }
        }
        finish()
      },
      fail: (err) => {
        if (ctl.aborted) return finish()
        handlers.onError('网络异常：' + ((err && err.errMsg) || '请求失败'))
        finish()
      }
    })

    ctl.abort = () => {
      ctl.aborted = true
      try {
        task.abort()
      } catch (e) {
        /* 忽略 */
      }
      finish()
    }

    // 有分块能力才挂监听；没有则走上面的 success 降级路径
    if (task && typeof task.onChunkReceived === 'function') {
      task.onChunkReceived((res) => {
        streamed = true
        let text = ''
        try {
          text = dec(res.data)
        } catch (e) {
          return
        }
        if (!text) return
        for (const ev of parser(text)) dispatchEvent(ev, handlers)
      })
    }
  })
}
// #endif

/**
 * 发一轮对话，流式收回答。
 *
 * @param {object} opt
 * @param {string}   opt.message           用户本轮输入（非空）
 * @param {string}  [opt.conversationId]   上一轮后端下发的会话 ID（首轮留空）
 * @param {string}  [opt.userId]           匿名标识，缺省自动生成
 * @param {(t:string)=>void} [opt.onDelta] 增量文本
 * @param {(id:string)=>void} [opt.onConv] 后端下发的新会话 ID
 * @param {(m:string)=>void} [opt.onError] 可展示的错误文案
 * @param {()=>void} [opt.onEnd]           收流结束（无论成败，用于恢复按钮状态）
 * @returns {{done: Promise<void>, abort: () => void}} `done` 可用于 await；`abort` 中断
 */
export function streamAiChat(opt = {}) {
  const { message, conversationId = '', userId, onDelta, onConv, onError, onEnd } = opt

  const handlers = {
    onDelta: (t) => onDelta && onDelta(t),
    onConv: (id) => onConv && onConv(id),
    onError: (m) => onError && onError(m),
    onEnd: () => onEnd && onEnd()
  }

  const ctl = { aborted: false, reader: null, abort: () => {} }

  const msg = String(message == null ? '' : message).trim()
  if (!msg) {
    // 空输入不该发请求（后端会直接回 400「问题不能为空」），就地给个可读提示
    handlers.onError('请输入你的问题')
    handlers.onEnd()
    return { done: Promise.resolve(), abort: () => {} }
  }

  const payload = {
    message: msg,
    conversationId: conversationId || '',
    userId: userId || getAiUserId()
  }

  const done = runStream(payload, handlers, ctl)
  ctl.done = done
  return ctl
}

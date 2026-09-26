/**
 * AI 流式协议层 —— **SSE 解析 + UTF-8 解码**。
 *
 * 本文件是**零依赖纯函数**（不 import 任何东西、不碰 uni / window），
 * 因此可以在 Node 下直接单测（见 tests/aiProtocol.test.mjs）。
 *
 * ┌ 为什么需要自己写 UTF-8 解码 ────────────────────────────────
 * │ 小程序端的 `onChunkReceived` 给的是 **ArrayBuffer**，而小程序**不保证**
 * │ 有 `TextDecoder`（那是 Web API）。更要命的是：流式分块会把一个中文字符
 * │ （UTF-8 下 3 字节）**从中间劈开** —— 前一个 chunk 结尾是 `0xE4 0xB8`，
 * │ 后一个 chunk 开头才是 `0xAD`。朴素实现会把这两半各解成一个乱码字符（\uFFFD）。
 * │ ⇒ 必须用**有状态**解码器：把不完整的尾部字节留到下一轮再拼。
 * └────────────────────────────────────────────────────────────
 *
 * 🚨 跨端只保留**这一份**解码器与解析器：H5 端不用浏览器原生 `TextDecoder`。
 *   两套实现必然会分叉，而本端真正的自动化验证渠道是 H5 回归（见 tests/），
 *   一旦两端行为不一致，就会变成「H5 全绿、小程序坏掉」这种回归抓不到的故障
 *   （本项目已有先例：`@click.self` 被小程序编译器静默丢弃，H5 侧完全正常）。
 *
 * 事件协议（与主站 frontend/src/components/AiAssistant.vue 完全一致，
 * 由后端 AiAssistantController#chat / AiAssistantService 下发）：
 *   data:{"type":"conv","conversationId":"..."}
 *   data:{"type":"delta","content":"一"}
 *   data:{"type":"error","message":"..."}
 */

/**
 * 闭合一个 SSE 事件块：把块内所有 `data:` 行拼起来再 JSON.parse。
 *
 * SSE 规范里同一个事件的多行 `data` 用 `\n` 连接；本项目后端每条事件只发一行，
 * 但仍按规范拼接，避免上游哪天改成分行输出就整条解析不出来。
 *
 * @param {string[]|null} lines 事件块内的原始行（已去掉行尾 CR）
 * @returns {object|null} 解析出的对象；非 data 行 / JSON 坏掉 / 空块 ⇒ null
 */
function finalize(lines) {
  if (!lines || !lines.length) return null
  const data = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.slice(0, 5) !== 'data:') continue
    let v = line.slice(5)
    // 规范允许 `data: x` 与 `data:x` 两种写法，前者的空格不算内容
    if (v.charAt(0) === ' ') v = v.slice(1)
    data.push(v)
  }
  if (!data.length) return null
  try {
    const obj = JSON.parse(data.join('\n'))
    return obj && typeof obj === 'object' ? obj : null
  } catch (e) {
    // 半截 JSON（理论上不会出现在「已按空行闭合」的块里）—— 丢弃而不是抛错，
    // 免得一个坏帧把整轮对话打断。
    return null
  }
}

/**
 * 创建一个**有状态**的 SSE 解析器。
 *
 * 用法：每次拿到解码后的文本就 `push(text)`，返回本轮**刚刚闭合**的事件数组。
 *
 * @returns {(text: string) => object[]}
 */
export function createSseParser() {
  let buf = ''
  let lines = null

  return function push(text) {
    if (typeof text !== 'string' || !text) return []
    buf += text

    const out = []
    let nl = -1
    while ((nl = buf.indexOf('\n')) !== -1) {
      // 末尾的 `\r` 要去掉：兼容 `\r\n` 换行的上游（不能简单 replace 整串，
      // 因为 `\r` 与 `\n` 可能分属相邻两个 chunk）
      const line = buf.slice(0, nl).replace(/\r$/, '')
      buf = buf.slice(nl + 1)

      if (line === '') {
        // 空行 = 事件边界
        const ev = finalize(lines)
        lines = null
        if (ev) out.push(ev)
        continue
      }
      if (line.charAt(0) === ':') continue // SSE 注释行（心跳），忽略
      if (!lines) lines = []
      lines.push(line)
    }
    return out
  }
}

/* ==================== UTF-8 解码 ==================== */

/** 把各种「字节容器」统一成普通数字数组；已经是字符串的按 UTF-8 编回去（幂等） */
function toBytes(input) {
  if (!input) return []
  if (typeof input === 'string') return strToBytes(input)
  if (input instanceof Uint8Array) return Array.prototype.slice.call(input)
  if (input instanceof ArrayBuffer) return Array.prototype.slice.call(new Uint8Array(input))
  if (Array.isArray(input)) return input
  // 小程序个别实现给的是带 buffer 的 TypedArray / 包装对象
  if (input.buffer instanceof ArrayBuffer) {
    const view = new Uint8Array(input.buffer)
    const off = typeof input.byteOffset === 'number' ? input.byteOffset : 0
    return Array.prototype.slice.call(view.subarray(off))
  }
  return []
}

/** 字符串 → UTF-8 字节（仅用于「上游已经是字符串」的容错路径） */
function strToBytes(s) {
  const out = []
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i)
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1)
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00)
        i++
      }
    }
    if (cp < 0x80) {
      out.push(cp)
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      )
    }
  }
  return out
}

/** 码点 → 字符（避开对 String.fromCodePoint 的依赖，小程序兼容性更稳） */
function fromCodePoint(cp) {
  if (cp <= 0xffff) return String.fromCharCode(cp)
  const v = cp - 0x10000
  return String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
}

/**
 * 创建**有状态**的 UTF-8 解码器。
 *
 * 关键点：不完整的尾部字节**不丢弃**，留到下一次 push 时与新字节拼接后再解，
 * 这样才能正确处理「一个中文字符被 chunk 边界劈成两半」。
 *
 * @returns {(input: Uint8Array|ArrayBuffer|number[]|string) => string}
 */
export function createUtf8Decoder() {
  let tail = []

  return function push(input) {
    const head = toBytes(input)
    if (!head.length && !tail.length) return ''

    const buf = tail.length ? tail.concat(head) : head
    tail = []

    let out = ''
    let i = 0
    while (i < buf.length) {
      const b0 = buf[i]
      let need
      if (b0 < 0x80) need = 1
      else if ((b0 & 0xe0) === 0xc0) need = 2
      else if ((b0 & 0xf0) === 0xe0) need = 3
      else if ((b0 & 0xf8) === 0xf0) need = 4
      else {
        // 非法起始字节（10xxxxxx 或 0xF8+）：跳过，避免死循环
        i++
        continue
      }

      // 序列不完整 ⇒ 剩余全部留给下一轮
      if (i + need > buf.length) break

      let cp
      if (need === 1) {
        cp = b0
      } else if (need === 2) {
        cp = ((b0 & 0x1f) << 6) | (buf[i + 1] & 0x3f)
      } else if (need === 3) {
        cp = ((b0 & 0x0f) << 12) | ((buf[i + 1] & 0x3f) << 6) | (buf[i + 2] & 0x3f)
      } else {
        cp =
          ((b0 & 0x07) << 18) |
          ((buf[i + 1] & 0x3f) << 12) |
          ((buf[i + 2] & 0x3f) << 6) |
          (buf[i + 3] & 0x3f)
      }
      out += fromCodePoint(cp)
      i += need
    }

    tail = buf.slice(i)
    return out
  }
}

/* ==================== 事件分发 ==================== */

/**
 * 把解析出来的事件按 `type` 分发给回调（页面不必自己 switch）。
 *
 * @param {object} ev 单个 SSE 事件
 * @param {{onDelta?:Function,onConv?:Function,onError?:Function}} handlers
 */
export function dispatchEvent(ev, handlers = {}) {
  if (!ev || !ev.type) return
  if (ev.type === 'delta') {
    if (handlers.onDelta && ev.content) handlers.onDelta(ev.content)
  } else if (ev.type === 'conv') {
    if (handlers.onConv && ev.conversationId) handlers.onConv(ev.conversationId)
  } else if (ev.type === 'error') {
    if (handlers.onError) handlers.onError(ev.message || '助手返回错误')
  }
}

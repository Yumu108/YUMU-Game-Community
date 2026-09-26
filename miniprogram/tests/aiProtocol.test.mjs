/**
 * AI 流式协议层单元测试 —— **SSE 解析 + UTF-8 解码**。
 *
 * 运行：
 *   cd miniprogram
 *   node --experimental-default-type=module tests/aiProtocol.test.mjs
 *
 * 为什么能直接 import：`src/utils/aiProtocol.js` **零 import**（刻意设计）。
 *   旁边的 `api/ai.js` 依赖 `api/config.js`，而 config 用了 uni-app 条件编译
 *   （`// #ifdef H5` / `#ifndef` 两个分支在普通 Node 里会**同时生效** ⇒ 重复声明语法错误），
 *   所以「依赖 config 的模块」没法在 Node 里跑。纯协议逻辑摘出来就能测。
 *
 * 🚨 这批断言防的是**真机上最典型的两种坏法**：
 *   ① 一个中文字符（UTF-8 三字节）被 chunk 边界**从中间劈开** ⇒ 朴素解码器吐出乱码；
 *   ② SSE 事件被网络分包**从中间劈开** ⇒ 朴素解析器把半条 JSON 丢掉，回答凭空少字。
 *   两者都不会报错，只会「内容不对」—— 属于本项目反复踩过的「静默错」。
 */
import { createSseParser, createUtf8Decoder, dispatchEvent } from '../src/utils/aiProtocol.js'

let pass = 0
let fail = 0

function ok(name, cond, extra = '') {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
}

/* ==================== A. UTF-8 解码 ==================== */
console.log('===== A. createUtf8Decoder（字节 → 文本）=====')

{
  const d = createUtf8Decoder()
  ok('A1 纯 ASCII', d([0x68, 0x69]) === 'hi', JSON.stringify(d([])))
}

{
  // '中' = E4 B8 AD
  const d = createUtf8Decoder()
  ok('A2 三字节中文字符（一次给全）', d([0xe4, 0xb8, 0xad]) === '中')
}

{
  // 🚨 本组的核心：把 '中' 从中间劈开
  const d = createUtf8Decoder()
  const first = d([0xe4])
  const second = d([0xb8, 0xad])
  ok(
    'A3 中文被 chunk 劈成两半（前半不吐乱码、后半补全）',
    first === '' && second === '中',
    `第一段=${JSON.stringify(first)} 第二段=${JSON.stringify(second)}`
  )
}

{
  // 😀 = F0 9F 98 80（四字节）
  const d = createUtf8Decoder()
  const a = d([0xf0, 0x9f])
  const b = d([0x98, 0x80])
  ok(
    'A4 四字节 emoji 被劈成两半',
    a === '' && b === '😀',
    `第一段=${JSON.stringify(a)} 第二段=${JSON.stringify(b)}`
  )
}

{
  // 一次只喂一个字节，逐字节重建「你好世界」
  const src = '你好世界'
  const raw = Buffer.from(src, 'utf8')
  const d = createUtf8Decoder()
  let out = ''
  for (let i = 0; i < raw.length; i++) out += d(raw.subarray(i, i + 1))
  ok('A5 逐字节喂入也能还原中文', out === src, JSON.stringify(out))
}

{
  const d = createUtf8Decoder()
  const buf = new Uint8Array([0xe6, 0x96, 0x87]).buffer
  ok('A6 支持 ArrayBuffer 入参', d(buf) === '文')
}

{
  const d = createUtf8Decoder()
  const got = d([0x41, 0xe4]) + d([0xb8, 0xad, 0x42])
  ok('A7 ASCII 与中文混排、跨 chunk 边界', got === 'A中B', JSON.stringify(got))
}

{
  const d = createUtf8Decoder()
  ok('A8 空输入返回空串（不抛错）', d([]) === '' && d(null) === '' && d(undefined) === '')
}

/* ==================== B. SSE 解析 ==================== */
console.log('\n===== B. createSseParser（文本 → 事件）=====')

{
  const p = createSseParser()
  const evs = p('data:{"type":"delta","content":"a"}\n\n')
  ok('B1 单条 delta', evs.length === 1 && evs[0].type === 'delta' && evs[0].content === 'a', JSON.stringify(evs))
}

{
  const p = createSseParser()
  const evs = p(
    'data:{"type":"conv","conversationId":"c1"}\n\ndata:{"type":"delta","content":"x"}\n\ndata:{"type":"delta","content":"y"}\n\n'
  )
  ok('B2 一个 chunk 里有多条事件', evs.length === 3, `拿到 ${evs.length} 条`)
  ok(
    'B2b 类型与顺序正确',
    evs[0].type === 'conv' && evs[0].conversationId === 'c1' && evs[1].content === 'x' && evs[2].content === 'y',
    JSON.stringify(evs)
  )
}

{
  // 🚨 事件被劈开：这是最关键的 B 组断言
  const p = createSseParser()
  const a = p('data:{"type":"de')
  const b = p('lta","content":"中"}\n')
  const c = p('\n')
  ok(
    'B3 SSE 事件被劈开也能闭合',
    a.length === 0 && b.length === 0 && c.length === 1 && c[0].content === '中',
    `a=${a.length} b=${b.length} c=${JSON.stringify(c)}`
  )
}

{
  const p = createSseParser()
  const evs = p('data:{"type":"error","message":"提问太频繁"}\n\n')
  ok('B4 error 事件带 message', evs[0].type === 'error' && evs[0].message === '提问太频繁', JSON.stringify(evs))
}

{
  const p = createSseParser()
  const evs = p('data:{"type":"delta",BROKEN\n\n')
  ok('B5 坏 JSON 被丢弃且不抛错', evs.length === 0)
}

{
  const p = createSseParser()
  const evs = p(': ping\n\ndata:{"type":"delta","content":"z"}\n\n')
  ok('B6 SSE 注释行（心跳）被忽略', evs.length === 1 && evs[0].content === 'z', JSON.stringify(evs))
}

{
  const p = createSseParser()
  const evs = p('data:{"type":"delta","content":"w"}\r\n\r\n')
  ok('B7 兼容 \\r\\n 换行的上游', evs.length === 1 && evs[0].content === 'w', JSON.stringify(evs))
}

{
  // `data:x`（冒号后无空格）与 `data: x` 都要认；`: ` 开头的非 data 行不算内容
  const p = createSseParser()
  const evs = p('event:message\ndata:{"type":"delta","content":"q"}\n\n')
  ok('B8 非 data 行（event:）不干扰', evs.length === 1 && evs[0].content === 'q', JSON.stringify(evs))
}

{
  const p = createSseParser()
  const evs = p('data:{"type":"delta",\ndata:"content":"m"}\n\n')
  ok('B9 多行 data 按规范拼接后再解析', evs.length === 1 && evs[0].content === 'm', JSON.stringify(evs))
}

{
  const p = createSseParser()
  ok('B10 只有半截、永不闭合时不吐事件', p('data:{"type":"delta","content":"没完').length === 0)
}

/* ==================== C. 端到端：字节级最恶劣切分 ==================== */
console.log('\n===== C. 端到端（字节流 → 完整回答）=====')

const FULL =
  'data:{"type":"conv","conversationId":"c9"}\n\n' +
  'data:{"type":"delta","content":"你"}\n\n' +
  'data:{"type":"delta","content":"好，我是"}\n\n' +
  'data:{"type":"delta","content":"YUMU 助手"}\n\n'

function runByteSplit(text, step) {
  const raw = Buffer.from(text, 'utf8')
  const dec = createUtf8Decoder()
  const parser = createSseParser()
  const evs = []
  for (let i = 0; i < raw.length; i += step) {
    const slice = raw.subarray(i, Math.min(i + step, raw.length))
    const chunkText = dec(slice)
    // ⚠️ `createSseParser()` 返回的是**函数**，直接调用它；不是带 .push 的对象
    for (const e of parser(chunkText)) evs.push(e)
  }
  return evs
}

{
  const evs = runByteSplit(FULL, 1)
  const text = evs.filter((e) => e.type === 'delta').map((e) => e.content).join('')
  ok('C1 按 1 字节切分（最恶劣）内容仍完整', text === '你好，我是YUMU 助手', JSON.stringify(text))
  ok('C1b conv 事件没丢', evs.some((e) => e.type === 'conv' && e.conversationId === 'c9'))
}

{
  const evs = runByteSplit(FULL, 7)
  const text = evs.filter((e) => e.type === 'delta').map((e) => e.content).join('')
  ok('C2 按 7 字节切分内容仍完整', text === '你好，我是YUMU 助手', JSON.stringify(text))
}

{
  const evs = runByteSplit(FULL, 4096)
  const text = evs.filter((e) => e.type === 'delta').map((e) => e.content).join('')
  ok('C3 整段一次到达也正确', text === '你好，我是YUMU 助手', JSON.stringify(text))
  ok('C3b 事件条数 = 4（1 conv + 3 delta）', evs.length === 4, `实际 ${evs.length}`)
}

/* ==================== D. dispatchEvent ==================== */
console.log('\n===== D. dispatchEvent（按 type 分发）=====')

{
  const seen = []
  dispatchEvent({ type: 'delta', content: 'a' }, { onDelta: (c) => seen.push('d:' + c) })
  dispatchEvent({ type: 'conv', conversationId: 'k' }, { onConv: (v) => seen.push('c:' + v) })
  dispatchEvent({ type: 'error', message: 'e' }, { onError: (m) => seen.push('e:' + m) })
  ok('D1 三类事件各归其位', seen.join('|') === 'd:a|c:k|e:e', seen.join('|'))
}

{
  let threw = false
  try {
    dispatchEvent({ type: 'unknown-x' }, { onDelta: () => {} })
    dispatchEvent(null, {})
    dispatchEvent({ type: 'delta' }, {}) // content 缺失
  } catch (e) {
    threw = true
  }
  ok('D2 未知 type / 空事件 / 缺字段都不抛错', !threw)
}

{
  // delta 但 content 为空串：不应触发 onDelta（避免页面产生空消息）
  let called = 0
  dispatchEvent({ type: 'delta', content: '' }, { onDelta: () => (called += 1) })
  ok('D3 空 content 不触发 onDelta', called === 0)
}

console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
process.exit(fail === 0 ? 0 : 1)

/**
 * AI 助手接口限频 / 输入保护冒烟（B5 后续补充：成本控制）
 *
 * 背景：/ai/chat 是 permitAll，每次调用都会消耗扣子 token，必须限频，
 * 否则任何人写个脚本就能刷爆账单。
 *
 * 用法：
 *   1) 用低阈值起一个独立实例（默认 20/min 打满太慢）：
 *      AI_RATE_PER_MINUTE=3 java -jar target/yumu-community-1.0.0.jar --server.port=8081
 *   2) node tests/ai-rate-limit.mjs            # 默认打 8081，阈值 3
 *      BASE=http://127.0.0.1:8081 LIMIT=5 node tests/ai-rate-limit.mjs
 *
 * 断言点：
 *   - 阈值内请求返回 text/event-stream（正常 SSE 流）
 *   - 超限请求返回 code=429 的 JSON（不是流；前端靠 content-type 识别后展示 message）
 *   - 空问题 / 超长问题返回 code=400
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8081'
const LIMIT = Number(process.env.LIMIT || 3)

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

/** 发一次 AI 请求：拿到响应后读第一个 chunk 就断开（避免等完整打字机输出）。 */
async function ask(message) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const resp = await fetch(`${BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, userId: 'ratelimit-test' }),
      signal: ctrl.signal
    })
    const ctype = resp.headers.get('content-type') || ''
    if (ctype.includes('text/event-stream')) {
      // 正常流：读一小段确认有内容就断开
      const reader = resp.body.getReader()
      const { value } = await reader.read()
      await reader.cancel().catch(() => {})
      return { stream: true, text: value ? new TextDecoder().decode(value) : '' }
    }
    const json = await resp.json().catch(() => null)
    return { stream: false, json }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  console.log(`\n=== AI 助手限频冒烟 (BASE=${BASE}, 阈值=${LIMIT}/min) ===\n`)

  // 1. 阈值内应全部放行（SSE 流）
  console.log(`[1] 连续 ${LIMIT} 次提问应放行`)
  for (let i = 1; i <= LIMIT; i++) {
    const r = await ask(`第 ${i} 个问题：社区怎么发帖？`)
    check(`第 ${i} 次返回 SSE 流`, r.stream === true, JSON.stringify(r).slice(0, 120))
  }

  // 2. 第 LIMIT+1 次应被限频
  console.log(`[2] 第 ${LIMIT + 1} 次应被限频（429）`)
  const blocked = await ask('超限问题：还能再问一次吗？')
  check('返回非流式 JSON', blocked.stream === false, JSON.stringify(blocked).slice(0, 160))
  check('业务码为 429', blocked.json?.code === 429, `实际 code=${blocked.json?.code}`)
  check('带可读提示文案', !!blocked.json?.message && String(blocked.json.message).includes('频繁'),
    `message=${blocked.json?.message}`)

  // 3. 输入保护
  console.log('[3] 输入校验')
  const empty = await ask('   ')
  check('空白问题 → 400', empty.json?.code === 400, `code=${empty.json?.code}`)
  const tooLong = await ask('啊'.repeat(2001))
  check('超长问题 → 400', tooLong.json?.code === 400, `code=${tooLong.json?.code}`)
  const okLen = await ask('啊'.repeat(2000))
  check('恰好 2000 字不报错', okLen.stream === true || okLen.json?.code === 429,
    `（可能因配额已耗尽而 429）${JSON.stringify(okLen).slice(0, 80)}`)

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error('脚本异常：', e.message); process.exit(1) })

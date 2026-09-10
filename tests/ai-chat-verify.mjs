/**
 * AI 助手（OpenAI 兼容直连）端到端验证
 *
 * 覆盖：
 *   1. SSE 协议：content-type / conv 下发 / delta 流式分片 / done 收尾
 *   2. 会话 ID：后端权威下发、多轮回传保持稳定、非法值被重生成（防缓存 key 注入）
 *   3. 多轮记忆：第二轮带上同一 convId 能被接受并延续会话
 *   4. 输入保护：空问题 / 超长问题 → code=400（JSON 而非 SSE）
 *   5. 实时快照注入：回答内包含社区实时数据（热门帖 / 热门游戏等）
 *   6. mock 兜底：未配置 LLM_API_KEY 时应自述"本地模拟模式"
 *
 * 用法（需后端 8080 在跑）：
 *   node tests/ai-chat-verify.mjs
 *   BASE=http://127.0.0.1:8080 node tests/ai-chat-verify.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE || 'http://127.0.0.1:8080'
const NL = String.fromCharCode(10)

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' —— ' + extra : ''}`) }
}
function section(t) { console.log(`\n${t}`) }

/** 发一次对话请求；SSE 流会读到结束为止。 */
async function ask(message, conversationId, timeoutMs = 60000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const body = { message, userId: 'ai-chat-verify' }
    if (conversationId !== undefined && conversationId !== null) body.conversationId = conversationId
    const resp = await fetch(`${BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const ctype = resp.headers.get('content-type') || ''
    if (!ctype.includes('text/event-stream')) {
      const j = await resp.json().catch(() => null)
      return { stream: false, http: resp.status, code: j && j.code, message: j && j.message, text: '' }
    }
    const raw = await resp.text()
    const events = []
    for (const block of raw.split(NL + NL)) {
      const payload = block.split(NL)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('')
      if (!payload) continue
      try { events.push(JSON.parse(payload)) } catch { /* ignore */ }
    }
    const deltas = events.filter((e) => e.type === 'delta').map((e) => e.content || '')
    const conv = events.find((e) => e.type === 'conv')
    return {
      stream: true,
      http: resp.status,
      events,
      deltas,
      text: deltas.join(''),
      convId: conv ? conv.conversationId : null,
      hasDone: events.some((e) => e.type === 'done'),
      errors: events.filter((e) => e.type === 'error').map((e) => e.message),
    }
  } finally {
    clearTimeout(timer)
  }
}

// ============================================================
console.log(`AI 助手直连验证 —— ${BASE}`)

// ---------- 0. 预热 & 模式探测 ----------
section('[0] 连通性与运行模式探测')
const first = await ask('你好')
if (!first.stream) {
  console.log(`  ❌ 未拿到 SSE 流（http=${first.http} code=${first.code} msg=${first.message}）`)
  console.log('\n=== 结果：0/1 通过 ===')
  process.exit(1)
}
const isMock = first.text.includes('本地模拟模式')
console.log(`  ℹ️ 当前模式：${isMock ? '本地 mock（未配置 LLM_API_KEY）' : '真实大模型直连'}`)

// ---------- 1. SSE 协议 ----------
section('[1] SSE 协议')
check('响应为 text/event-stream', first.stream)
check('收到 conv 事件且 ID 非空', !!first.convId, `convId=${first.convId}`)
check('收到多个 delta 分片（确实流式）', first.deltas.length > 1, `${first.deltas.length} 片`)
check('收到 done 事件收尾', first.hasDone)
check('回复正文非空', first.text.trim().length > 0, `${first.text.length} 字符`)
check('无 error 事件', first.errors.length === 0, first.errors.join(' | '))

// ---------- 2. 会话 ID 契约 ----------
section('[2] 会话 ID 契约')
const convA = first.convId
const second = await ask('再问一句', convA)
check('多轮回传同一 convId 时后端沿用它', second.convId === convA,
  `期望 ${convA}，实际 ${second.convId}`)
check('第二轮同样收到 done', second.hasDone)

const illegal = await ask('越权试试', '../../etc/passwd')
check('非法 conversationId 被重新生成（防缓存 key 注入）',
  !!illegal.convId && illegal.convId !== '../../etc/passwd' && /^[A-Za-z0-9_-]+$/.test(illegal.convId),
  `实际 ${illegal.convId}`)

// ---------- 3. 实时快照注入 ----------
section('[3] 实时数据快照注入')
if (isMock) {
  check('mock 回答包含社区实时数据标记（热门帖子/热门游戏/公告/精选）',
    /热门帖子|热门游戏|最新公告|今日精选/.test(first.text))
} else {
  // 真实模式下回答由上游生成（回显），快照是否真的注入改由 [7] 抓包断言
  check('真实模式：回答来自上游（上游回显格式）', /ECHO\[/.test(first.text))
}

// ---------- 4. 输入保护 ----------
section('[4] 输入保护（成本护栏）')
const empty = await ask('')
check('空问题 → code=400', empty.code === 400, `code=${empty.code}`)
check('空问题返回 JSON 而非 SSE', empty.stream === false)

const tooLong = await ask('啊'.repeat(2001))
check('超长问题（>2000 字）→ code=400', tooLong.code === 400, `code=${tooLong.code}`)

const okLen = await ask('行'.repeat(1999))
check('边界内长度（1999 字）正常放行', okLen.stream === true, `stream=${okLen.stream}`)

// ---------- 5. mock 兜底自述 ----------
section('[5] 运行模式自述')
if (isMock) {
  check('未配 key 时自述"本地模拟模式"', first.text.includes('本地模拟模式'))
  check('mock 提示指向 LLM_API_KEY', first.text.includes('LLM_API_KEY'))
} else {
  check('真实模式：回答未出现 mock 自述', !first.text.includes('本地模拟模式'))
}

// ---------- 6. 静态提示装载（读启动日志） ----------
section('[6] 静态提示（人设+知识库）装载')
try {
  const logDir = path.resolve(process.cwd(), '..', 'backend', 'logs')
  const candidates = fs.existsSync(logDir)
    ? fs.readdirSync(logDir).filter((f) => f.endsWith('.log')).map((f) => path.join(logDir, f))
    : []
  let hit = ''
  for (const f of candidates) {
    const content = fs.readFileSync(f, 'utf8')
    const m = content.match(/AI 助手静态提示装载完成：总计 (\d+) 字符（其中知识库 (\d+) 字符）/)
    if (m) hit = m[0]
  }
  const total = hit ? Number(hit.match(/总计 (\d+)/)[1]) : 0
  const kb = hit ? Number(hit.match(/知识库 (\d+)/)[1]) : 0
  check('启动日志有静态提示装载记录', !!hit, hit || '未在 backend/logs 找到（可能工作目录不同）')
  check('知识库正文已装载且非空', kb > 3000, `知识库 ${kb} 字符`)
  check('人设 Prompt 已装载', total > kb, `总计 ${total} 字符 / 知识库 ${kb} 字符`)
} catch (e) {
  check('读取启动日志', false, e.message)
}

// ============================================================
// 7. 真实上游分支（需先起 tests/mock-llm-upstream.mjs，并以 LLM_MOCK=false 起后端）
//    这段覆盖 mock 模式完全绕过的高风险代码：OpenAI 兼容 SSE 分片解析、[DONE]、
//    reasoning_content 丢弃、上游报错翻译、system/历史是否按契约组装。
// ============================================================
if (process.env.UPSTREAM_PROBE === '1') {
  const UP = process.env.UPSTREAM || 'http://127.0.0.1:9099'
  const resetUpstream = () => fetch(`${UP}/_reset`, { method: 'POST' })
  const upstreamRequests = async () => (await fetch(`${UP}/_requests`)).json()

  section('[7] 真实上游分支（OpenAI 兼容 SSE 解析）')
  await resetUpstream()

  // ---- 7.1 上游收到正确的请求 ----
  const r1 = await ask('真实分支探测')
  const captured1 = await upstreamRequests()
  check('上游收到请求', captured1.length === 1, `实际 ${captured1.length} 次`)
  if (captured1.length) {
    const c = captured1[0]
    check('请求路径为 /chat/completions', /\/chat\/completions$/.test(c.url), c.url)
    check('带 Bearer 鉴权头', /^Bearer\s+\S+$/.test(c.authorization || ''), String(c.authorization).slice(0, 12))
    check('请求体 stream=true', c.body && c.body.stream === true)
    check('请求体带 model', !!(c.body && c.body.model), c.body && c.body.model)

    const msgs = (c.body && c.body.messages) || []
    const sys = msgs.find((m) => m.role === 'system')
    const sysText = sys ? String(sys.content || '') : ''
    check('messages[0] 为 system', msgs.length > 0 && msgs[0].role === 'system')
    check('system 内嵌知识库正文', sysText.includes('YUMU 游戏社区') && sysText.includes('知识库'),
      `${sysText.length} 字符`)
    check('system 内嵌实时快照', /热门帖子|热门游戏|最新公告|今日精选/.test(sysText))
    check('最后一条为 user 且为本轮问题',
      msgs.length > 1 && msgs[msgs.length - 1].role === 'user'
      && String(msgs[msgs.length - 1].content) === '真实分支探测')
  }

  // ---- 7.2 流式分片拼接 ----
  check('delta 分片被打包成完整句子', r1.text.includes('ECHO[真实分支探测]'), r1.text.slice(0, 60))
  check('上游 stream 结束符 [DONE] 被正确识别（正常发出 done）', r1.hasDone)
  check('无 error 事件', r1.errors.length === 0, r1.errors.join(' | '))
  check('system 长度经由上游回显可见', /SYSTEM=\d{4,}/.test(r1.text), (r1.text.match(/SYSTEM=\d+/) || [])[0])

  // ---- 7.3 多轮历史确实传给了上游 ----
  const r2 = await ask('第二轮问题', r1.convId)
  const captured2 = await upstreamRequests()
  const c2 = captured2[captured2.length - 1] || {}
  const msgs2 = (c2.body && c2.body.messages) || []
  const nonSystem = msgs2.filter((m) => m.role !== 'system')
  check('第二轮上游收到 3 条非 system 消息（上轮问+上轮答+本轮问）',
    nonSystem.length === 3, `实际 ${nonSystem.length} 条`)
  check('历史中的上一轮提问被带回',
    nonSystem.some((m) => m.role === 'user' && String(m.content) === '真实分支探测'))
  check('历史中的上一轮回答被带回',
    nonSystem.some((m) => m.role === 'assistant' && String(m.content).includes('ECHO[')))

  // ---- 7.4 reasoning_content 必须被丢弃 ----
  const r3 = await ask('TRIGGER_REASON 测试')
  check('思维链内容不出现在面板', !r3.text.includes('思维链'), r3.text.slice(0, 60))
  check('最终回答正常输出', r3.text.includes('思考完毕'), r3.text.slice(0, 60))

  // ---- 7.5 上游报错被翻译成可读提示 ----
  const r4 = await ask('TRIGGER_401 测试')
  check('上游 401 时推 error 事件', r4.errors.length > 0, `errors=${r4.errors.length}`)
  check('错误信息提示检查 API Key',
    r4.errors.some((m) => /API Key/i.test(m)), r4.errors.join(' | ').slice(0, 120))
} else {
  console.log('\n[7] 真实上游分支 —— 已跳过（需 UPSTREAM_PROBE=1 + mock-llm-upstream.mjs）')
}

// ============================================================
const total = pass + fail
console.log(`\n=== 结果：${pass}/${total} 通过 ===`)
process.exit(fail === 0 ? 0 : 1)

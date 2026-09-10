/**
 * 假 LLM 上游（OpenAI 兼容 /chat/completions）—— 专供验证后端 streamOpenAi 的解析逻辑。
 *
 * 为什么需要它：后端 mock 模式完全绕过「真实大模型调用」这条分支，
 * 而 OpenAI 兼容的 SSE 分片解析（choices[0].delta.content）、[DONE] 结束、
 * reasoning_content 忽略、上游报错翻译 —— 都是本次改动风险最高的代码。
 * 用这个假上游就能在**不需要真实 API Key** 的前提下把这条分支完整跑起来。
 *
 * 行为（按最后一条 user 消息内容分派）：
 *   - 含 TRIGGER_401    → 返回 401 + OpenAI 风格错误 JSON
 *   - 含 TRIGGER_REASON → 先推 reasoning_content（思维链，后端应丢弃）再推 content
 *   - 其它              → 回显 ECHO[...] + system 长度 + 历史条数，分片流式返回
 *
 * 自省接口：GET /_requests 返回收到的全部请求体（供断言 messages 结构）
 *           POST /_reset 清空记录
 *
 * 用法：node tests/mock-llm-upstream.mjs   （默认监听 127.0.0.1:9099）
 */
import http from 'node:http'

const PORT = Number(process.env.PORT || 9099)
const NL = String.fromCharCode(10)

/** @type {Array<{url:string, authorization:string|null, body:any}>} */
const received = []

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => resolve(raw))
  })
}

const server = http.createServer(async (req, res) => {
  // ---- 自省接口 ----
  if (req.url === '/_requests' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(received))
    return
  }
  if (req.url === '/_reset' && req.method === 'POST') {
    received.length = 0
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')
    return
  }

  const raw = await readBody(req)
  let body = null
  try { body = JSON.parse(raw) } catch { /* ignore */ }

  received.push({
    url: req.url,
    authorization: req.headers['authorization'] || null,
    accept: req.headers['accept'] || null,
    body,
  })

  const messages = (body && body.messages) || []
  const users = messages.filter((m) => m.role === 'user')
  const lastUser = users.length ? String(users[users.length - 1].content || '') : ''
  const systemMsg = messages.find((m) => m.role === 'system')
  const systemLen = systemMsg ? String(systemMsg.content || '').length : 0
  // 历史 = 除 system 与「最后一条 user」之外的消息条数
  const historyCount = messages.filter((m) => m.role !== 'system').length - (users.length ? 1 : 0)

  // ---- 分支 1：模拟上游鉴权失败 ----
  if (lastUser.includes('TRIGGER_401')) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'Authentication Fails, Your api key is invalid', type: 'authentication_error' } }))
    return
  }

  // ---- 正常：SSE 流式返回 ----
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const send = (obj) => res.write('data: ' + JSON.stringify(obj) + NL + NL)

  // ---- 分支 2：先推思维链（后端必须丢弃 reasoning_content）----
  if (lastUser.includes('TRIGGER_REASON')) {
    send({ choices: [{ index: 0, delta: { reasoning_content: '（这是不该出现在面板里的思维链）' } }] })
    send({ choices: [{ index: 0, delta: { content: '思考完毕。' } }] })
  } else {
    const answer = `ECHO[${lastUser}] SYSTEM=${systemLen} HIST=${historyCount}`
    // 每 4 个字符一片，模拟真实分片
    for (let i = 0; i < answer.length; i += 4) {
      send({ choices: [{ index: 0, delta: { content: answer.slice(i, i + 4) } }] })
    }
  }

  send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  res.write('data: [DONE]' + NL + NL)
  res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock LLM upstream listening on http://127.0.0.1:${PORT}`)
})

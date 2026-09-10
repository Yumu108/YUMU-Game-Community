// WebSocket 实时通知 验证
// 用法：node tests/ws-verify.mjs  （需后端运行于 http://localhost:8080/api）
//
// 覆盖场景：
//   ① 无效 token 握手被拒（连接关闭，收不到 connected 帧）
//   ② 有效 token 握手成功，收到 connected 帧
//   ③ A 点赞 B 的帖 → B 在线收到 type=notification / notifyType=1 推送
//   ④ A 私信 B → B 在线收到 type=message 推送，且含 fromName
//   ⑤ 推送 payload 字段完整（targetId / senderId / at）

const BASE = 'http://localhost:8080/api'
const WS_BASE = 'ws://localhost:8080/api/ws'

let pass = 0, fail = 0
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg) }
  else { fail++; console.log('  ✗ FAIL:', msg) }
}

async function j(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await r.json().catch(() => ({}))
  return { http: r.status, code: data.code, data: data.data, msg: data.message, raw: data }
}
const jpost = (p, b, t) => j('POST', p, b, t)
const jget = (p, t) => j('GET', p, null, t)

/** 打开一个 WS 连接，收集消息，resolve 出客户端对象。 */
function openWs(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`)
    const client = { ws, messages: [], open: false, closed: false }
    ws.onopen = () => { client.open = true; resolve(client) }
    ws.onmessage = (ev) => {
      try { client.messages.push(JSON.parse(ev.data)) } catch (e) { /* ignore */ }
    }
    ws.onclose = () => { client.closed = true }
    ws.onerror = () => { client.closed = true; if (!client.open) reject(new Error('connect failed')) }
    // 兜底：3s 内未 open 视为失败（用于无效 token 检测）
    setTimeout(() => { if (!client.open && !client.closed) reject(new Error('timeout')) }, 3000)
  })
}

/** 等待满足条件的消息到达（轮询），超时返回 null。 */
async function waitForMessage(client, pred, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const hit = client.messages.find(pred)
    if (hit) return hit
    await new Promise(r => setTimeout(r, 100))
  }
  return null
}

const suffix = Date.now().toString(36).slice(-6)

async function main() {
  console.log('═══ WebSocket 实时通知 验证 ═══\n')

  // 0. 账号
  const lr = await jpost('/auth/login', { username: 'admin', password: 'admin123456' })
  assert(lr.code === 200 && lr.data?.token, 'admin 登录')
  const A = lr.data.token

  const ra = await jpost('/auth/register', { username: 'ws_a_' + suffix, password: 'pass123456', nickname: 'WSA' })
  assert(ra.code === 200 && ra.data?.token, '注册 A（操作者）')
  const A1 = ra.data.token, A1id = ra.data.user?.id

  const rb = await jpost('/auth/register', { username: 'ws_b_' + suffix, password: 'pass123456', nickname: 'WSB' })
  assert(rb.code === 200 && rb.data?.token, '注册 B（被通知者，长期在线）')
  const B1 = rb.data.token, B1id = rb.data.user?.id

  // 1. 无效 token 握手被拒
  console.log('\n[1] 无效 token → 握手被拒')
  let invalidRejected = false
  try {
    const c = await openWs('not.a.valid.jwt.token')
    // 若侥幸 open，检查是否立即收到 connected（不应收到）
    const got = await waitForMessage(c, m => m.type === 'connected', 2000)
    invalidRejected = !got
    try { c.ws.close() } catch (e) {}
  } catch (e) {
    // 连接失败/超时 = 被拒，符合预期
    invalidRejected = true
  }
  assert(invalidRejected, '无效 token 连接被拒（收不到 connected 帧）')

  // 2. 有效 token 握手成功
  console.log('\n[2] 有效 token → 握手成功，收到 connected 帧')
  let bClient
  try {
    bClient = await openWs(B1)
    assert(bClient.open, 'B 的 WS 连接已建立')
  } catch (e) {
    assert(false, 'B 的 WS 连接建立失败: ' + e.message)
    return
  }
  const connected = await waitForMessage(bClient, m => m.type === 'connected', 3000)
  assert(connected && connected.userId === B1id, `收到 connected 帧（userId=${connected?.userId}）`)

  // 3. B 发帖 → admin 通过 → A 点赞 → B 收到通知推送
  console.log('\n[3] A 点赞 B 的帖 → B 收到通知推送')
  const pa = await jpost('/posts', {
    boardId: 1, gameId: 2,
    title: 'ws-like-post-' + suffix,
    content: 'please like me'
  }, B1)
  assert(pa.code === 200 && pa.data?.id, 'B 发帖')
  const pid = pa.data.id
  await jpost(`/admin/posts/${pid}/approve`, null, A)

  // 确保 B 的 WS 已就绪后再点赞
  await new Promise(r => setTimeout(r, 300))
  const likeR = await jpost(`/posts/${pid}/like`, null, A1)
  assert(likeR.code === 200, 'A 点赞 B 的帖 200')

  const notif = await waitForMessage(bClient, m => m.type === 'notification' && m.notifyType === 1, 5000)
  assert(notif, 'B 在线收到 type=notification 推送')
  assert(notif?.senderId === A1id, `推送 senderId 为 A（${notif?.senderId}）`)
  assert(notif?.targetId === pid, `推送 targetId 为帖子（${notif?.targetId}）`)
  assert(typeof notif?.at === 'number', '推送含时间戳 at')

  // 4. A 私信 B → B 收到消息推送
  console.log('\n[4] A 私信 B → B 收到消息推送')
  const msgR = await jpost('/messages', { toUserId: B1id, content: 'hello B from A' }, A1)
  assert(msgR.code === 200, 'A 发送私信 200')

  const pushMsg = await waitForMessage(bClient, m => m.type === 'message', 5000)
  assert(pushMsg, 'B 在线收到 type=message 推送')
  assert(pushMsg?.fromUserId === A1id, `推送 fromUserId 为 A（${pushMsg?.fromUserId}）`)
  assert(pushMsg?.fromName === 'WSA', `推送含发送者昵称（${pushMsg?.fromName}）`)
  assert(pushMsg?.content === 'hello B from A', '推送含私信内容')

  // 收尾：关闭 B 的 WS
  try { bClient.ws.close() } catch (e) {}

  console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error('运行异常:', e); process.exit(2) })

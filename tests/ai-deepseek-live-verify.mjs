/**
 * 智能助手「真实大模型直连」验证（DeepSeek / 任意 OpenAI 兼容上游）
 *
 * 与 ai-chat-verify.mjs 的区别：
 *   ai-chat-verify.mjs  —— 用 LLM_MOCK=true 跑，验证 SSE 协议、限频、多轮缓存等「骨架」；
 *   本脚本               —— 后端必须以 LLM_MOCK=false + 真实 LLM_API_KEY 启动，验证「真的接上了大模型」：
 *                          1) 回答不再是本地模拟文案（关键：不含「本地模拟模式」字样）
 *                          2) 流式 delta 逐块拼出的正文与常识问答自洽（问身份答得上来）
 *                          3) 知识库真的进了 system（问社区规则能答出 YUMU 专有信息）
 *                          4) conversationId 多轮记忆生效（第二轮记得第一轮说了什么）
 *                          5) 上游异常能被翻译成可读 error 事件（不抛 500、不裸奔堆栈）
 *
 * 运行：需要后端 8080 在跑；中文负载用 node fetch，不要用 curl（Windows 下编码会炸）
 *   cd tests && node ai-deepseek-live-verify.mjs
 *
 * 会消耗少量 token（默认 4~5 次调用，每次上限 1024 token）。
 */

const BASE = process.env.API_BASE || 'http://localhost:8080/api';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};
const sec = (t) => console.log(`\n=== ${t} ===`);

/**
 * 发起一次流式对话，返回 { convId, text, events, error, elapsed }
 * 事件结构（后端 AiAssistantService SSE 发送辅助）：
 *   {type:'conv', conversationId} | {type:'delta', content} | {type:'done'} | {type:'error', message}
 */
async function chat(message, { conversationId = null, userId = 'live-verify' } = {}) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId, userId }),
  });
  const ct = res.headers.get('content-type') || '';
  // 非 SSE = 被限频/校验拦下（全局处理器返回 HTTP 200 + code=429/400 的 JSON）
  if (!ct.includes('text/event-stream')) {
    const body = await res.text();
    return { events: [], text: '', convId: null, error: `非 SSE 响应(${res.status}): ${body.slice(0, 200)}`, elapsed: Date.now() - t0 };
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '', convId = null, error = null;
  const events = [];
  const deltas = [];

  const handle = (raw) => {
    // 一个 SSE 事件块：可能多行，取 data: 行拼接
    const dataLines = raw.split('\n').filter((l) => l.startsWith('data:'));
    if (!dataLines.length) return;
    const payload = dataLines.map((l) => l.slice(5).trim()).join('');
    if (!payload) return;
    let obj;
    try { obj = JSON.parse(payload); } catch { return; }
    events.push(obj);
    if (obj.type === 'conv') convId = obj.conversationId;
    else if (obj.type === 'delta') deltas.push(obj.content ?? '');
    else if (obj.type === 'error') error = obj.message;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) handle(buf);
  return { events, text: deltas.join(''), convId, error, elapsed: Date.now() - t0 };
}

const MOCK_MARK = '本地模拟模式';

(async () => {
  console.log(`目标后端：${BASE}\n（前置条件：LLM_MOCK=false 且 LLM_API_KEY 已配置）`);

  // ---------- 1) 基础连通 + 真实模式判定 ----------
  sec('1. 基础连通 / 真实模式判定');
  const q1 = await chat('你是谁？用一句话介绍你自己。');
  console.log(`  ⏱ 耗时 ${q1.elapsed}ms，收到 ${q1.events.length} 个 SSE 事件，正文 ${q1.text.length} 字`);
  ok('返回了 SSE 事件流', q1.events.length > 0, `events=${q1.events.length}`);
  ok('首事件是 conv（下发会话 ID）', q1.events[0]?.type === 'conv', `type=${q1.events[0]?.type}`);
  ok('convId 非空', !!q1.convId, `convId=${q1.convId}`);
  ok('有 delta 增量正文', q1.text.length > 0, `${q1.text.length} 字`);
  ok('末事件是 done（正常收尾）', q1.events[q1.events.length - 1]?.type === 'done',
     `type=${q1.events[q1.events.length - 1]?.type}`);
  ok('未出现 error 事件', !q1.error, q1.error || '');
  ok('★ 走的是真实模型（正文不含 mock 文案）', !q1.text.includes(MOCK_MARK));
  console.log(`  回答摘要：${q1.text.slice(0, 120).replace(/\n/g, ' ')}`);

  // ---------- 2) 流式分块（真实上游应为多块 delta） ----------
  sec('2. 流式分块');
  const deltaCount = q1.events.filter((e) => e.type === 'delta').length;
  ok('delta 分块 > 1（真流式，非一次性整段下发）', deltaCount > 1, `delta=${deltaCount} 块`);

  // ---------- 3) 知识库注入（问 YUMU 专有规则） ----------
  sec('3. 知识库注入（YUMU 社区专有信息）');
  const q2 = await chat('YUMU 游戏社区里，普通用户发帖之后需要经过什么流程才会公开展示？');
  ok('第 2 问正常返回', !q2.error && q2.text.length > 0, q2.error || `${q2.text.length} 字`);
  const kbHit = /审核|待审核|审核通过|版主|管理员/.test(q2.text);
  ok('★ 答出社区审核机制（知识库命中）', kbHit);
  console.log(`  回答摘要：${q2.text.slice(0, 160).replace(/\n/g, ' ')}`);

  // ---------- 4) 多轮记忆 ----------
  sec('4. 多轮记忆（conversationId 维度）');
  const cid = q2.convId;
  const q3 = await chat('我刚才问的是什么问题？只回答那个问题的主题，不要展开。', { conversationId: cid });
  ok('第 3 问正常返回', !q3.error && q3.text.length > 0, q3.error || `${q3.text.length} 字`);
  ok('沿用了同一 conversationId', q3.convId === cid, `${q3.convId} vs ${cid}`);
  const remember = /审核|发帖|帖/.test(q3.text);
  ok('★ 记得上一轮内容（多轮记忆生效）', remember);
  console.log(`  回答摘要：${q3.text.slice(0, 120).replace(/\n/g, ' ')}`);

  // ---------- 5) 独立会话隔离 ----------
  sec('5. 会话隔离（新 conversationId 不应串记忆）');
  const q4 = await chat('我刚才问的是什么问题？', { conversationId: null, userId: 'live-verify-2' });
  ok('新会话拿到新 convId', q4.convId && q4.convId !== cid, `${q4.convId}`);
  const leaked = /审核流程|发帖之后需要经过/.test(q4.text);
  ok('新会话未串入上一会话内容', !leaked);

  // ---------- 6) 空输入校验（不消耗 token） ----------
  sec('6. 输入校验');
  const q5 = await chat('   ');
  ok('空问题被拒（非 SSE 响应）', !!q5.error, (q5.error || '').slice(0, 100));

  console.log(`\n${'='.repeat(52)}`);
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  console.log('='.repeat(52));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\n脚本异常：', e);
  process.exit(1);
});

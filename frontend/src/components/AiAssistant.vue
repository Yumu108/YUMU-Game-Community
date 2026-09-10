<template>
  <div class="ai-root">
    <button v-if="!open" class="ai-fab" title="社区智能助手" @click="open = true">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.9-5.5A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
      </svg>
      <span class="ai-fab-tip">智能助手</span>
    </button>

    <section v-if="open" class="ai-panel">
      <header class="ai-head">
        <div class="ai-title">
          <span class="ai-dot"></span>
          <div>
            <div class="ai-name">YUMU 智能助手</div>
            <div class="ai-sub">游戏咨询 · 社区玩法 · 实时动态</div>
          </div>
        </div>
        <div class="ai-head-actions">
          <button class="ai-icon-btn" title="新对话" @click="newChat">新建</button>
          <button class="ai-icon-btn" title="收起" @click="open = false">收起</button>
        </div>
      </header>

      <div ref="listEl" class="ai-msgs">
        <div v-if="messages.length === 0" class="ai-welcome">
          <div class="ai-welcome-emoji">ROBOT</div>
          <p>你好，我是 YUMU 社区智能助手。问我社区玩法、游戏攻略或社区实时动态吧。</p>
          <div class="ai-chips">
            <button v-for="q in quickQuestions" :key="q" class="ai-chip" @click="send(q)">{{ q }}</button>
          </div>
        </div>

        <div v-for="(m, i) in messages" :key="i" class="ai-row" :class="m.role">
          <div class="ai-bubble" :class="m.role">
            <div v-if="m.role === 'user'" class="ai-user-text">{{ m.content }}</div>
            <div v-else class="ai-md" v-html="renderMarkdown(m.content)"></div>
          </div>
        </div>

        <div v-if="streaming && currentEmpty" class="ai-row assistant">
          <div class="ai-bubble assistant"><span class="ai-typing"><i></i><i></i><i></i></span></div>
        </div>
      </div>

      <footer class="ai-input">
        <textarea
          v-model="input"
          rows="1"
          placeholder="问点什么（Enter 发送，Shift+Enter 换行）"
          @keydown.enter.exact.prevent="send()"
        ></textarea>
        <button class="ai-send" :disabled="streaming" @click="send()">发送</button>
      </footer>
    </section>
  </div>
</template>

<script setup>
import { ref, reactive, nextTick } from 'vue';

const open = ref(false);
const input = ref('');
const streaming = ref(false);
const messages = ref([]);
const convId = ref('');
const listEl = ref(null);
const currentEmpty = ref(false);

const AI_UID_KEY = 'yumu_ai_uid';
let aiUserId = localStorage.getItem(AI_UID_KEY);
if (!aiUserId) {
  aiUserId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  localStorage.setItem(AI_UID_KEY, aiUserId);
}

const quickQuestions = [
  '社区怎么发帖？',
  '怎么成为版主？',
  '今天有什么热门帖子？',
  '推荐几个热门游戏',
  '签到积分怎么算？',
];

function scrollToBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
  });
}

async function send(text) {
  const msg = (text ?? input.value).trim();
  if (!msg || streaming.value) return;
  input.value = '';
  messages.value.push({ role: 'user', content: msg });
  const assistant = reactive({ role: 'assistant', content: '' });
  messages.value.push(assistant);
  currentEmpty.value = true;
  streaming.value = true;
  scrollToBottom();

  const payload = { message: msg, conversationId: convId.value, userId: aiUserId };
  try {
    const resp = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      assistant.content = '请求失败（HTTP ' + resp.status + '）';
      return;
    }
    // 业务异常（限频 429 / 参数错误 400）由全局处理器返回 JSON 而非 SSE 流。
    // 必须先判断 content-type：直接读流会解析不出任何 data 行，用户只看到空白气泡。
    const ctype = resp.headers.get('content-type') || '';
    if (ctype.indexOf('text/event-stream') === -1) {
      const data = await resp.json().catch(() => null);
      assistant.content = (data && data.message) || '请求被拒绝，请稍后再试';
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf(String.fromCharCode(10) + String.fromCharCode(10))) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleSseChunk(chunk, assistant);
      }
    }
    if (buffer.trim()) handleSseChunk(buffer, assistant);
  } catch (e) {
    assistant.content += String.fromCharCode(10) + String.fromCharCode(10) + '连接中断：' + e.message;
  } finally {
    streaming.value = false;
    currentEmpty.value = false;
    scrollToBottom();
  }
}

function handleSseChunk(chunk, assistant) {
  const lines = chunk.split(String.fromCharCode(10));
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    try {
      const json = JSON.parse(data);
      if (json.type === 'delta') assistant.content += json.content;
      else if (json.type === 'conv') convId.value = json.conversationId;
      else if (json.type === 'error') assistant.content += String.fromCharCode(10) + String.fromCharCode(10) + '⚠️ ' + json.message;
    } catch (_) {
      /* ignore malformed */
    }
  }
}

function newChat() {
  convId.value = '';
  messages.value = [];
  currentEmpty.value = false;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const CODE_OPEN = '@@CODEBLOCK@@';

function renderMarkdown(text) {
  const blocks = [];
  const fenceRe = new RegExp(FENCE + '(\\w*)\\n([\\s\\S]*?)' + FENCE, 'g');
  let s = text.replace(fenceRe, (m, lang, code) => {
    const i = blocks.length;
    blocks.push(code.replace(/\n$/, ''));
    return CODE_OPEN + i + CODE_OPEN;
  });
  s = escapeHtml(s);
  s = s
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h2>$1</h2>')
    .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>');
  s = s.replace(/(?:^(?:- .*(?:\n|$))+)/gm, (block) => {
    const items = block.trim().split('\n').map((l) => l.replace(/^- /, '')).map((l) => '<li>' + l + '</li>').join('');
    return '<ul>' + items + '</ul>';
  });
  s = s.replace(/\n/g, '<br>');
  s = s.replace(new RegExp(CODE_OPEN + '(\d+)' + CODE_OPEN, 'g'), (m, i) => '<pre><code>' + escapeHtml(blocks[+i]) + '</code></pre>');
  return s;
}
</script>

<style scoped>
.ai-root {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 9999;
  font-family: inherit;
}
.ai-fab {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  color: #fff;
  background: linear-gradient(135deg, #7c5cff 0%, #19e3c2 100%);
  box-shadow: 0 8px 24px rgba(124, 92, 255, 0.45);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.ai-fab:hover {
  transform: translateY(-2px) scale(1.04);
  box-shadow: 0 12px 30px rgba(124, 92, 255, 0.6);
}
.ai-fab-tip {
  font-size: 10px;
  margin-top: 1px;
  opacity: 0.9;
}
.ai-panel {
  width: 384px;
  height: 580px;
  max-height: calc(100vh - 44px);
  background: #16161f;
  border: 1px solid rgba(124, 92, 255, 0.35);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #e8e8f0;
}
.ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: linear-gradient(135deg, rgba(124, 92, 255, 0.22), rgba(25, 227, 194, 0.12));
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.ai-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ai-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #19e3c2;
  box-shadow: 0 0 0 4px rgba(25, 227, 194, 0.2);
}
.ai-name {
  font-weight: 700;
  font-size: 15px;
}
.ai-sub {
  font-size: 11px;
  opacity: 0.65;
}
.ai-head-actions {
  display: flex;
  gap: 6px;
}
.ai-icon-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #cfcfe0;
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.ai-icon-btn:hover {
  background: rgba(124, 92, 255, 0.25);
  color: #fff;
}
.ai-msgs {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ai-welcome {
  margin: auto;
  text-align: center;
  opacity: 0.85;
}
.ai-welcome-emoji {
  font-size: 40px;
  margin-bottom: 8px;
}
.ai-welcome p {
  font-size: 13px;
  line-height: 1.6;
  margin: 0 0 14px;
}
.ai-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.ai-chip {
  background: rgba(124, 92, 255, 0.14);
  border: 1px solid rgba(124, 92, 255, 0.35);
  color: #cdbcff;
  border-radius: 14px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}
.ai-chip:hover {
  background: rgba(124, 92, 255, 0.28);
  color: #fff;
}
.ai-row {
  display: flex;
}
.ai-row.user {
  justify-content: flex-end;
}
.ai-row.assistant {
  justify-content: flex-start;
}
.ai-bubble {
  max-width: 86%;
  padding: 10px 13px;
  border-radius: 14px;
  font-size: 13.5px;
  line-height: 1.65;
  word-break: break-word;
}
.ai-bubble.user {
  background: linear-gradient(135deg, #7c5cff, #6a4bf0);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.ai-bubble.assistant {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom-left-radius: 4px;
}
.ai-user-text {
  white-space: pre-wrap;
}
.ai-md :deep(h2),
.ai-md :deep(h3),
.ai-md :deep(h4) {
  margin: 10px 0 6px;
  line-height: 1.4;
}
.ai-md :deep(h2) { font-size: 16px; }
.ai-md :deep(h3) { font-size: 14.5px; }
.ai-md :deep(h4) { font-size: 13.5px; opacity: 0.9; }
.ai-md :deep(ul) {
  margin: 6px 0;
  padding-left: 18px;
}
.ai-md :deep(li) {
  margin: 3px 0;
}
.ai-md :deep(blockquote) {
  margin: 8px 0;
  padding: 6px 12px;
  border-left: 3px solid #19e3c2;
  background: rgba(25, 227, 194, 0.08);
  border-radius: 6px;
  opacity: 0.92;
}
.ai-md :deep(code) {
  background: rgba(255, 255, 255, 0.1);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}
.ai-md :deep(pre) {
  background: #0f0f17;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.ai-md :deep(pre code) {
  background: none;
  padding: 0;
}
.ai-typing {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}
.ai-typing i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #19e3c2;
  animation: ai-blink 1.2s infinite ease-in-out;
}
.ai-typing i:nth-child(2) { animation-delay: 0.2s; }
.ai-typing i:nth-child(3) { animation-delay: 0.4s; }
@keyframes ai-blink {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}
.ai-input {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}
.ai-input textarea {
  flex: 1;
  resize: none;
  max-height: 90px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 9px 11px;
  color: #e8e8f0;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
}
.ai-input textarea:focus {
  outline: none;
  border-color: #7c5cff;
}
.ai-send {
  align-self: flex-end;
  background: linear-gradient(135deg, #7c5cff, #19e3c2);
  border: none;
  color: #fff;
  border-radius: 10px;
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.ai-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ai-pop-enter-active,
.ai-pop-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.ai-pop-enter-from,
.ai-pop-leave-to {
  transform: translateY(12px) scale(0.98);
  opacity: 0;
}
</style>

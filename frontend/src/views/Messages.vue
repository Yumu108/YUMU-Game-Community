<template>
  <AppLayout>
    <div class="messages">
      <!-- 会话列表 -->
      <div v-if="!peerId" class="conv-list">
        <div class="section-title">私信</div>
        <div v-for="c in conversations" :key="c.userId" class="conv" @click="open(c.userId)">
          <el-badge :value="c.unread" :hidden="!c.unread" :max="99">
            <el-avatar :size="44" :src="c.avatar">{{ c.name?.[0] || '游' }}</el-avatar>
          </el-badge>
          <div class="conv-info">
            <div class="conv-name">{{ c.name }}</div>
            <div class="conv-last">{{ c.lastMessage || '暂无消息' }}</div>
          </div>
          <div class="conv-time">{{ c.lastTime }}</div>
        </div>
        <el-empty v-if="conversations.length === 0" description="还没有私信，去用户主页找人聊聊吧～" :image-size="90" />
      </div>

      <!-- 对话 -->
      <div v-else class="chat">
        <div class="chat-head">
          <el-button text @click="back">← 返回</el-button>
          <span class="chat-peer">{{ peerName }}</span>
        </div>
        <div class="chat-body" ref="bodyEl">
          <div v-for="m in messages" :key="m.id" class="msg" :class="{ me: m.fromUserId === myId }">
            <div class="bubble">{{ m.content }}</div>
            <div class="msg-time">{{ m.createdAt }}</div>
          </div>
          <el-empty v-if="messages.length === 0" description="开始聊天吧～" :image-size="80" />
        </div>
        <div class="chat-input">
          <el-input v-model="draft" placeholder="输入消息，回车发送" @keyup.enter="send" />
          <el-button type="primary" @click="send">发送</el-button>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AppLayout from '@/layout/AppLayout.vue'
import {
  getConversations,
  getMessages,
  sendMessage,
  markMessagesRead
} from '@/api/community'
import { useUserStore } from '@/store'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const peerId = computed(() => (route.params.userId ? Number(route.params.userId) : null))
const myId = computed(() => userStore.userInfo?.id)
const peerName = ref('')
const conversations = ref([])
const messages = ref([])
const draft = ref('')
const bodyEl = ref(null)

async function loadConversations() {
  conversations.value = await getConversations()
}
async function loadChat() {
  if (!peerId.value) return
  const page = await getMessages(peerId.value)
  messages.value = page.records.slice().reverse() // 正序展示（旧→新）
  const conv = conversations.value.find((c) => c.userId === peerId.value)
  peerName.value = conv?.name || '用户'
  await markMessagesRead(peerId.value)
  await nextTick(() => {
    if (bodyEl.value) bodyEl.value.scrollTop = bodyEl.value.scrollHeight
  })
}
function open(id) {
  router.push(`/messages/${id}`)
}
function back() {
  router.push('/messages')
}
async function send() {
  const text = draft.value.trim()
  if (!text) return
  if (!peerId.value) return ElMessage.warning('请先选择一个会话')
  await sendMessage({ toUserId: peerId.value, content: text })
  draft.value = ''
  await loadChat()
}

onMounted(async () => {
  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录')
    router.push('/login')
    return
  }
  await loadConversations()
  if (peerId.value) await loadChat()
})
watch(
  () => route.params.userId,
  async () => {
    if (peerId.value) await loadChat()
    else await loadConversations()
  }
)
</script>

<style scoped>
.messages {
  max-width: 720px;
  margin: 0 auto;
}
.section-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--t1);
  margin: 4px 0 12px;
}
.conv-list {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px;
}
.conv {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 10px;
  cursor: pointer;
}
.conv:hover {
  background: var(--bg-3);
}
.conv-info {
  flex: 1;
  min-width: 0;
}
.conv-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--t1);
}
.conv-last {
  font-size: 12.5px;
  color: var(--t3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conv-time {
  font-size: 12px;
  color: var(--t3);
  flex-shrink: 0;
}
.chat {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 140px);
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.chat-peer {
  font-weight: 700;
  color: var(--t1);
}
.chat-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.msg {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  max-width: 78%;
}
.msg.me {
  align-self: flex-end;
  align-items: flex-end;
}
.bubble {
  padding: 9px 13px;
  border-radius: 12px;
  background: var(--bg-3);
  color: var(--t1);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.me .bubble {
  background: var(--brand);
  color: #fff;
}
.msg-time {
  font-size: 11px;
  color: var(--t3);
  margin-top: 4px;
}
.chat-input {
  display: flex;
  gap: 10px;
  padding: 12px;
  border-top: 1px solid var(--border);
}
</style>

<template>
  <AppLayout>
    <BackButton />
    <div class="notif">
      <div class="notif-head">
        <div class="section-title">通知</div>
        <div class="notif-head-actions">
          <el-button text size="small" :disabled="!filteredList.length" @click="readAll">全部已读</el-button>
          <el-button text size="small" type="danger" :disabled="!hasReadInTab" @click="clearRead">清空已读</el-button>
        </div>
      </div>
      <!-- 通知中心 6 Tab：全部 / 回复我的 / 赞我的 / @我的 / 关注 / 系统 -->
      <div class="notif-tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="ntab"
          :class="{ on: activeTab === t.key }"
          @click="activeTab = t.key"
        >
          {{ t.label }}
          <span v-if="unreadMap[t.key]" class="ntab-badge">{{ unreadMap[t.key] }}</span>
        </button>
      </div>
      <div
        v-for="n in filteredList"
        :key="n.id"
        class="item"
        :class="{ unread: !n.isRead }"
        @click="openItem(n)"
      >
        <el-avatar :size="40" class="n-ava">{{ (n.senderName || '系').charAt(0) }}</el-avatar>
        <div class="n-body">
          <div class="n-text"><b>{{ n.senderName }}</b> {{ n.content }}</div>
          <div class="n-time">{{ n.createdAt }}</div>
        </div>
        <span class="n-type" :class="'t' + n.type">{{ typeLabel(n.type) }}</span>
      </div>
      <el-empty v-if="filteredList.length === 0" :description="emptyText" :image-size="90" />
    </div>
  </AppLayout>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppLayout from '@/layout/AppLayout.vue'
import BackButton from '@/components/BackButton.vue'
import { getNotifications, markNotificationRead, clearReadNotifications } from '@/api/community'
import { useUserStore } from '@/store'

const router = useRouter()
const userStore = useUserStore()
const list = ref([])
const activeTab = ref('all') // 默认「全部」

// 通知 type → Tab key（与后端约定）：1=赞 2=回复 3=关注 4=公告 5=审核 6=@
// 9-09：拆为 6 Tab；「系统」只收公告(type=4) + 审核(type=5)，关注(type=3)独立成 Tab
const tabs = [
  { key: 'all',     label: '全部',     types: [1, 2, 3, 4, 5, 6] },
  { key: 'reply',   label: '回复我的', types: [2] },
  { key: 'like',    label: '赞我的',   types: [1] },
  { key: 'mention', label: '@我的',    types: [6] },
  { key: 'follow',  label: '关注',     types: [3] },
  { key: 'system',  label: '系统',     types: [4, 5] }
]

function typeLabel(t) {
  return { 1: '点赞', 2: '回复', 3: '关注', 4: '公告', 5: '审核', 6: '@' }[t] || '通知'
}

// 各 Tab 未读数（红点）
const unreadMap = computed(() => {
  const m = { all: 0, reply: 0, like: 0, mention: 0, follow: 0, system: 0 }
  for (const t of tabs) {
    for (const n of list.value) {
      if (!n.isRead && t.types.includes(n.type)) m[t.key]++
    }
  }
  return m
})

const filteredList = computed(() => {
  const cur = tabs.find((t) => t.key === activeTab.value)
  if (!cur) return []
  return list.value.filter((n) => cur.types.includes(n.type))
})

// 当前 Tab 是否还有「已读」通知（决定「清空已读」按钮是否可点）
const hasReadInTab = computed(() => {
  const cur = tabs.find((t) => t.key === activeTab.value)
  if (!cur) return false
  return list.value.some((n) => n.isRead && cur.types.includes(n.type))
})

const emptyText = computed(() => {
  const map = {
    all: '还没有任何通知～',
    reply: '还没有人回复你～',
    like: '还没有人给你点赞～',
    mention: '还没有人@你～',
    follow: '还没有人关注你～',
    system: '暂时没有系统通知'
  }
  return map[activeTab.value] || '还没有通知～'
})

async function load() {
  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录')
    router.push('/login')
    return
  }
  list.value = await getNotifications()
}
async function openItem(n) {
  await markNotificationRead(n.id)
  if (!n.isRead) {
    n.isRead = 1
    userStore.setUnreadCount(Math.max(0, userStore.unreadCount - 1))
  }
  // 路由跳转：回复/赞/审核/@ → 帖子详情（@通知跳到被@的帖子，type=2 回复通知带 ?replyId 跳楼层）；关注 → 对方主页；公告 → 公告页
  if ((n.type === 1 || n.type === 2 || n.type === 5 || n.type === 6) && n.targetId) {
    // 9-07：type=2 回复通知 / type=6 @通知（如果是回复内 @）都用 sourceId 跳到该楼
    const q = n.sourceId ? `?replyId=${n.sourceId}` : ''
    router.push(`/post/${n.targetId}${q}`)
  } else if (n.type === 3 && n.senderId) {
    router.push(`/user/${n.senderId}`)
  } else if (n.type === 4) {
    router.push('/announcements')
  } else if (n.targetId) {
    router.push(`/post/${n.targetId}`)
  }
}
async function readAll() {
  await markNotificationRead(null)
  list.value.forEach((n) => (n.isRead = 1))
  userStore.setUnreadCount(0)
  ElMessage.success('已全部标记为已读')
}
// 清空已读：弹窗确认 → 按当前 Tab 的 types 范围清后端 is_read=1 记录（未读保留）
async function clearRead() {
  try {
    await ElMessageBox.confirm('是否要清除已读消息？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return // 用户取消
  }
  const cur = tabs.find((t) => t.key === activeTab.value)
  await clearReadNotifications(cur.types)
  await load()
  ElMessage.success('已清除已读消息')
}

onMounted(load)
</script>

<style scoped>
.notif {
  max-width: 720px;
  margin: 0 auto;
}
.notif-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.notif-head-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.section-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--t1);
}
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  margin-bottom: 10px;
  cursor: pointer;
}
.item.unread {
  border-color: var(--brand);
  background: var(--brand-soft);
}
.n-ava {
  background: var(--brand-soft);
  color: var(--brand);
  font-weight: 700;
  flex-shrink: 0;
}
.n-body {
  flex: 1;
  min-width: 0;
}
.n-text {
  font-size: 13.5px;
  color: var(--t2);
}
.n-text b {
  color: var(--t1);
}
.n-time {
  font-size: 11.5px;
  color: var(--t3);
  margin-top: 4px;
}
.n-type {
  font-size: 11.5px;
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
  background: var(--bg-3);
  color: var(--t3);
}
.n-type.t3 {
  color: var(--brand);
}
.n-type.t4 {
  color: var(--brand-2);
}
.n-type.t5 {
  color: #f56c6c;
}
.n-type.t6 {
  color: var(--brand);
  background: var(--brand-soft);
}
/* 4 Tab 切换（回复/赞/@/系统） */
.notif-tabs {
  display: flex;
  gap: 6px;
  margin: 8px 0 14px;
  flex-wrap: wrap;
}
.ntab {
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--t2);
  font-size: 13px;
  font-weight: 600;
  padding: 6px 13px;
  border-radius: 999px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}
.ntab:hover {
  border-color: var(--brand);
  color: var(--brand);
}
.ntab.on {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.ntab-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 0 6px;
  border-radius: 999px;
  background: #ff4d4f;
  color: #fff;
  line-height: 16px;
}
.ntab.on .ntab-badge {
  background: rgba(255, 255, 255, 0.28);
}
</style>

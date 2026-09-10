<template>
  <AppLayout>
    <BackButton />
    <div class="ann-page">
      <div class="ann-head">
        <h1 class="ann-title">📢 社区公告</h1>
        <p class="ann-sub">系统公告、版本更新、活动通知 — 由管理员发布</p>
      </div>
      <div v-if="loading" class="a-loading"><el-skeleton :rows="6" animated /></div>
      <el-empty v-else-if="!list.length" description="暂无公告" :image-size="120" />
      <ul v-else class="ann-list">
        <li v-for="a in list" :key="a.id" class="ann-item">
          <div class="ann-item-head">
            <h3 class="ann-item-title">{{ a.title }}</h3>
            <span class="ann-item-meta num">{{ a.creatorName }} · {{ a.createdAt }}</span>
          </div>
          <p class="ann-item-content">{{ a.content }}</p>
        </li>
      </ul>
    </div>
  </AppLayout>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import AppLayout from '@/layout/AppLayout.vue'
import BackButton from '@/components/BackButton.vue'
import { getAnnouncements } from '@/api/community'

const list = ref([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    list.value = await getAnnouncements(50)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.ann-page {
  max-width: 820px;
  margin: 0 auto;
  padding: 10px 0;
}
.ann-head {
  margin-bottom: 18px;
}
.ann-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 800;
  color: var(--t1);
}
.ann-sub {
  margin: 0;
  font-size: 13px;
  color: var(--t3);
}
.ann-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ann-item {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-left: 3px solid #f6c453;
  border-radius: var(--radius);
  padding: 14px 18px;
  transition: all 0.15s;
}
.ann-item:hover {
  border-color: rgba(246, 196, 83, 0.45);
  transform: translateY(-1px);
}
.ann-item-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.ann-item-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--t1);
}
.ann-item-meta {
  font-size: 11.5px;
  color: var(--t3);
  margin-left: auto;
}
.ann-item-content {
  margin: 0;
  font-size: 14px;
  color: var(--t2);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.a-loading {
  padding: 30px 0;
}
</style>
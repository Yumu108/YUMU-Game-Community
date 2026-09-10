<template>
  <AppLayout>
    <div v-if="tag" class="tagpage">
      <!-- 面包屑 -->
      <div class="crumb">
        <router-link to="/" class="link">综合首页</router-link>
        <span class="sep">/</span>
        <span class="cur">标签：#{{ tag.name }}</span>
      </div>

      <div class="tp-head">
        <h1 class="tp-title">#{{ tag.name }}</h1>
        <span class="tp-count num">{{ tag.count }} 个帖子</span>
      </div>

      <div class="tp-list">
        <PostCard v-for="p in posts" :key="p.id" :post="p" />
        <el-empty v-if="!loading && posts.length === 0" description="该标签下暂无帖子" />
      </div>

      <el-pagination
        v-if="total > size"
        class="tp-pager"
        layout="prev, pager, next"
        :total="total"
        :page-size="size"
        :current-page="current"
        @current-change="onPage"
      />
    </div>

    <el-skeleton v-else :rows="8" animated />
  </AppLayout>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '@/layout/AppLayout.vue'
import PostCard from '@/components/PostCard.vue'
import { getTag, getPostsByTag } from '@/api/community'

const route = useRoute()
const tag = ref(null)
const posts = ref([])
const total = ref(0)
const current = ref(1)
const size = ref(10)
const loading = ref(false)

async function load() {
  const id = route.params.id
  loading.value = true
  try {
    const [t, page] = await Promise.all([
      getTag(id),
      getPostsByTag(id, { current: current.value, size: size.value })
    ])
    tag.value = t
    posts.value = page.records
    total.value = page.total
  } finally {
    loading.value = false
  }
}
function onPage(p) {
  current.value = p
  load()
}

onMounted(load)
watch(() => route.params.id, () => {
  current.value = 1
  load()
})
</script>

<style scoped>
.tagpage {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 22px;
}
.crumb {
  font-size: 12.5px;
  color: var(--t3);
  margin-bottom: 14px;
}
.crumb .sep {
  margin: 0 7px;
}
.tp-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}
.tp-title {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: var(--t1);
}
.tp-count {
  font-size: 13px;
  color: var(--t3);
}
.tp-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tp-pager {
  margin-top: 18px;
  justify-content: center;
}
</style>

<template>
  <aside class="rail">
    <!-- ① 公告 -->
    <div class="card ann-card">
      <div class="ann-head">
        <div class="section-title">📢 公告</div>
        <a class="ann-more" @click="goAllAnnouncements">查看全部 ›</a>
      </div>
      <ul class="news">
        <li
          v-for="n in news"
          :key="n.id"
          class="news-item"
          @click="goAnnouncement(n.id)"
        >
          <span class="news-title">{{ n.title }}</span>
          <span class="news-content">{{ n.content }}</span>
        </li>
        <li v-if="!news.length" class="news-empty">暂无公告</li>
      </ul>
    </div>

    <!-- ② 热门榜 -->
    <div class="card">
      <div class="section-title">🔥 热门榜</div>
      <ul class="hot">
        <li
          v-for="(h, i) in hot"
          :key="h.id"
          class="hot-item"
          @click="goPost(h.id)"
        >
          <span class="rank" :class="{ top: i < 3 }">{{ i + 1 }}</span>
          <span class="h-title">{{ h.title }}</span>
          <span class="h-heat num">{{ formatHeat(h.heat) }}</span>
        </li>
      </ul>
    </div>

    <!-- ③ 活跃玩家 -->
    <div class="card">
      <div class="section-title">⚡ 活跃玩家</div>
      <ul class="users">
        <li v-for="u in users" :key="u.id" class="user" @click="goUser(u.id)">
          <el-avatar :size="32" :src="u.avatar" class="u-ava">{{ u.name?.[0] || '游' }}</el-avatar>
          <div class="u-meta">
            <div class="u-name">{{ u.name }}</div>
            <div class="u-badge" :class="`lv-${u.level || 1}`">{{ u.badge }}</div>
          </div>
        </li>
      </ul>
    </div>

    <!-- ④ 热门标签 -->
    <div class="card">
      <div class="section-title">🏷 热门标签</div>
      <div class="tags">
        <span
          v-for="t in tags"
          :key="t.id"
          class="tag"
          @click="goTag(t.id)"
        >#{{ t.name }} <i class="t-count num">{{ t.count }}</i></span>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  getHotList,
  getActiveUsers,
  getAnnouncements,
  getHotTags
} from '@/api/community'

const router = useRouter()
const hot = ref([])
const users = ref([])
const news = ref([])
const tags = ref([])

function goPost(id) {
  router.push(`/post/${id}`)
}
function goUser(id) {
  if (id) router.push(`/user/${id}`)
}
function goTag(id) {
  router.push(`/tag/${id}`)
}
function goAnnouncement(id) {
  // 公告详情目前合并在列表中：点击查看全部页可看到完整内容
  router.push('/announcements')
}
function goAllAnnouncements() {
  router.push('/announcements')
}
function formatHeat(n) {
  return n >= 10000 ? (n / 10000).toFixed(1) + 'w' : n
}

onMounted(async () => {
  const [h, u, a, t] = await Promise.all([
    getHotList(),
    getActiveUsers(),
    getAnnouncements(3),
    getHotTags(12)
  ])
  hot.value = h
  users.value = u
  news.value = a
  tags.value = t
})
</script>

<style scoped>
.rail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
}
.hot {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hot-item {
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  font-size: 13px;
  color: var(--t2);
}
.hot-item:hover .h-title {
  color: var(--brand);
}
.rank {
  flex: none;
  width: 18px;
  text-align: center;
  font-family: var(--font-num);
  font-weight: 700;
  color: var(--t3);
}
.rank.top {
  color: var(--accent);
}
.h-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s;
}
.h-heat {
  flex: none;
  font-size: 11px;
  color: var(--t3);
}
.users {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.user:hover {
  background: rgba(124, 92, 255, 0.1);
}
.user:hover .u-name {
  color: var(--brand);
}
.u-ava {
  background: var(--bg-3);
  font-size: 16px;
}
.u-name {
  font-size: 13px;
  color: var(--t1);
  font-weight: 600;
}
.u-badge {
  font-size: 11px;
  color: var(--t3);
}
.u-badge.lv-1 { color: #9ca3af; }
.u-badge.lv-2 { color: #cd7f32; font-weight: 700; }
.u-badge.lv-3 { color: #c0c0c0; font-weight: 700; }
.u-badge.lv-4 { color: #f6c453; font-weight: 700; }
.u-badge.lv-5 { color: #c084fc; font-weight: 700; }
.ann-card {
  border-left: 3px solid #f6c453;
  background: linear-gradient(160deg, rgba(246, 196, 83, 0.06), rgba(31, 27, 61, 0.4));
}
.ann-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
.ann-more {
  font-size: 11.5px;
  color: #f6c453;
  cursor: pointer;
  font-weight: 600;
  transition: color 0.15s;
}
.ann-more:hover {
  color: #fff;
  text-shadow: 0 0 6px rgba(246, 196, 83, 0.6);
}
.news {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.news-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
  color: var(--t2);
  line-height: 1.5;
  padding: 7px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.news-item:hover {
  background: rgba(246, 196, 83, 0.08);
}
.news-title {
  color: var(--t1);
  font-weight: 700;
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.news-content {
  font-size: 11.5px;
  color: var(--t3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.news-empty {
  font-size: 12px;
  color: var(--t3);
  font-style: italic;
  padding: 8px 0;
}
/* 热门标签 */
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 11px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-3);
  color: var(--t2);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.tag:hover {
  border-color: var(--brand);
  color: var(--brand);
}
.t-count {
  font-size: 11px;
  color: var(--t3);
  font-style: normal;
}
</style>

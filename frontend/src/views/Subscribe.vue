<template>
  <AppLayout>
    <BackButton />
    <div class="sub">
      <div class="s-head">
        <h1 class="s-title">🔔 我的订阅</h1>
        <p class="s-sub">订阅你关心的板块与关键词，首页与这里都会优先展示相关内容。</p>
      </div>

      <el-tabs v-model="tab" class="s-tabs">
        <el-tab-pane label="我的订阅" name="manage" />
        <el-tab-pane label="订阅流" name="feed" />
      </el-tabs>

      <!-- 管理订阅 -->
      <div v-if="tab === 'manage'" class="s-manage">
        <!-- 板块订阅 -->
        <section class="s-card">
          <h3 class="s-sec-title">📌 板块订阅</h3>
          <div v-if="subs.boards.length" class="s-chips">
            <span v-for="b in subs.boards" :key="b.id" class="s-chip">
              {{ b.icon }} {{ b.name }}
              <span class="s-x" @click="unsubBoard(b)">×</span>
            </span>
          </div>
          <p v-else class="s-muted">还没有订阅任何板块。</p>
          <div class="s-add">
            <el-select v-model="pickBoard" placeholder="选择板块订阅" filterable clearable class="s-sel">
              <el-option
                v-for="b in boardOptions"
                :key="b.id"
                :label="`${b.emoji} ${b.name}`"
                :value="b.id"
              />
            </el-select>
            <el-button type="primary" size="small" :disabled="!pickBoard" @click="addBoard">订阅板块</el-button>
          </div>
        </section>

        <!-- 关键词订阅 -->
        <section class="s-card">
          <h3 class="s-sec-title">🔍 关键词订阅</h3>
          <div v-if="subs.keywords.length" class="s-chips">
            <span v-for="k in subs.keywords" :key="k" class="s-chip kw">
              #{{ k }}
              <span class="s-x" @click="unsubKeyword(k)">×</span>
            </span>
          </div>
          <p v-else class="s-muted">还没有订阅任何关键词。</p>
          <div class="s-add">
            <el-input
              v-model="kwInput"
              class="s-kw"
              placeholder="输入关键词，如：原神 / 攻略 / 联机"
              maxlength="50"
              @keyup.enter="addKeyword"
            />
            <el-button type="primary" size="small" :disabled="!kwInput.trim()" @click="addKeyword">订阅关键词</el-button>
          </div>
        </section>
      </div>

      <!-- 订阅流 -->
      <div v-else class="s-feed">
        <div v-if="feedLoading && feed.records.length === 0" class="s-sk">
          <div v-for="n in 4" :key="n" class="sk"><el-skeleton :rows="2" animated /></div>
        </div>
        <div v-else-if="!feed.records.length" class="s-empty">
          <el-empty description="订阅点内容后，这里会聚合你关心的帖子～" :image-size="90" />
        </div>
        <template v-else>
          <PostCard v-for="p in feed.records" :key="p.id" :post="p" />
          <el-pagination
            v-if="feed.total > feed.size"
            class="s-page"
            layout="prev, pager, next"
            :current-page="feed.current"
            :page-size="feed.size"
            :total="feed.total"
            @current-change="onFeedPage"
          />
        </template>
      </div>
    </div>
  </AppLayout>
</template>

<script setup>
import { ref, reactive, onMounted, watch } from 'vue'
import AppLayout from '@/layout/AppLayout.vue'
import BackButton from '@/components/BackButton.vue'
import PostCard from '@/components/PostCard.vue'
import {
  getSubscriptions,
  toggleBoardSubscription,
  toggleKeywordSubscription,
  getSubscriptionFeed,
  getBoards
} from '@/api/community'

const tab = ref('manage')
const subs = reactive({ boards: [], keywords: [] })
const boardOptions = ref([])
const pickBoard = ref('')
const kwInput = ref('')

const feed = reactive({ records: [], total: 0, pages: 0, current: 1, size: 10 })
const feedLoading = ref(false)

async function loadSubs() {
  try {
    const d = await getSubscriptions()
    subs.boards = d.boards || []
    subs.keywords = d.keywords || []
  } catch (e) {}
}
async function loadBoards() {
  try {
    const res = await getBoards()
    const flat = [...res.parents]
    res.parents.forEach((p) => flat.push(...res.childrenOf(p.id)))
    boardOptions.value = flat
  } catch (e) {}
}
async function addBoard() {
  if (!pickBoard.value) return
  try {
    const r = await toggleBoardSubscription(pickBoard.value)
    ElMessage.success(r.followed ? '已订阅板块' : '已取消')
    pickBoard.value = ''
    await loadSubs()
  } catch (e) {}
}
async function unsubBoard(b) {
  try {
    await toggleBoardSubscription(b.id)
    ElMessage.success(`已取消订阅「${b.name}」`)
    await loadSubs()
  } catch (e) {}
}
async function addKeyword() {
  const k = kwInput.value.trim()
  if (!k) return
  try {
    const r = await toggleKeywordSubscription(k)
    ElMessage.success(r.followed ? `已订阅关键词「${k}」` : '已取消')
    kwInput.value = ''
    await loadSubs()
  } catch (e) {}
}
async function unsubKeyword(k) {
  try {
    await toggleKeywordSubscription(k)
    ElMessage.success(`已取消订阅「${k}」`)
    await loadSubs()
  } catch (e) {}
}

async function loadFeed() {
  feedLoading.value = true
  try {
    const data = await getSubscriptionFeed({ current: feed.current, size: feed.size })
    feed.records = data.records
    feed.total = data.total
    feed.pages = data.pages
    feed.current = data.current
  } finally {
    feedLoading.value = false
  }
}
function onFeedPage(p) {
  feed.current = p
  loadFeed()
}

watch(tab, (t) => {
  if (t === 'feed') loadFeed()
})

onMounted(async () => {
  await Promise.all([loadSubs(), loadBoards()])
})
</script>

<style scoped>
.sub {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 22px;
}
.s-head {
  margin-bottom: 14px;
}
.s-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 800;
  color: var(--t1);
}
.s-sub {
  margin: 0;
  font-size: 13px;
  color: var(--t3);
}
.s-card {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 14px;
}
.s-sec-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--t1);
}
.s-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.s-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(124, 92, 255, 0.14);
  color: #c4b5ff;
  font-size: 13px;
  font-weight: 600;
}
.s-chip.kw {
  background: rgba(25, 227, 194, 0.14);
  color: #19e3c2;
}
.s-x {
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  opacity: 0.7;
}
.s-x:hover {
  opacity: 1;
  color: #fff;
}
.s-muted {
  font-size: 12.5px;
  color: var(--t3);
  margin: 0 0 12px;
}
.s-add {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.s-sel {
  width: 240px;
}
.s-kw {
  width: 240px;
}
.s-feed {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.s-sk {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sk {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
}
.s-empty {
  padding: 30px 0;
}
.s-page {
  justify-content: center;
  margin-top: 8px;
}
</style>

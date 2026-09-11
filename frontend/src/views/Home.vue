<template>
  <AppLayout>
    <!-- 公告跑马灯弹窗：首次访问首页自动弹出（9-08：v-model 必须带 :visible，否则 Vue 3 默认绑 modelValue，prop visible 拿不到值，弹窗永远不显示） -->
    <AnnouncementModal v-model:visible="annoVisible" :items="announcements" @close="onAnnoClose" />

    <!-- Hero：热门话题大图轮播 -->
    <section class="hero">
      <div
        v-if="heroPosts.length"
        class="hero-stage"
        :style="heroStyle"
        @click="goPost(heroPosts[heroIdx].id)"
      >
        <div class="hero-mask" />
        <div class="hero-inner">
          <span class="hero-badge">🔥 热门话题</span>
          <h1 class="hero-title">{{ heroPosts[heroIdx].title }}</h1>
          <div class="hero-meta">
            <span class="hero-board">{{ heroPosts[heroIdx].boardName }}</span>
            <span class="hero-heat num">{{ formatHeat(heroPosts[heroIdx].heat) }} 热度</span>
          </div>
        </div>
      </div>
      <div v-else class="hero hero-empty">
        <div class="hero-inner">
          <h1 class="hero-title">YUMU 玩家社区</h1>
          <p class="hero-meta">和千万玩家一起聊游戏、晒攻略、交朋友</p>
        </div>
      </div>

      <!-- 轮播指示点 -->
      <div v-if="heroPosts.length > 1" class="hero-dots">
        <button
          v-for="(p, i) in heroPosts"
          :key="p.id"
          class="dot"
          :class="{ on: i === heroIdx }"
          @click="heroIdx = i"
        />
      </div>

      <!-- 侧边小图卡 -->
      <div v-if="sidePosts.length" class="hero-side">
        <div
          v-for="(p, i) in sidePosts"
          :key="p.id"
          class="side-card"
          @click="goPost(p.id)"
        >
          <span class="side-rank" :class="{ top: i < 2 }">{{ i + 1 }}</span>
          <span class="side-title">{{ p.title }}</span>
          <span class="side-heat num">{{ formatHeat(p.heat) }}</span>
        </div>
      </div>
    </section>

    <!-- 1.2：热门板块入口 → 热门游戏 -->
    <section class="quick">
      <div class="quick-head">🎮 热门游戏 <span class="quick-more" @click="goGames">进入游戏库 ›</span></div>
      <div class="quick-scroll">
        <div
          v-for="b in boards"
          :key="b.id"
          class="quick-chip"
          @click="goGame(b.id)"
        >
          <el-avatar :size="22" :src="b.cover">{{ b.name?.[0] }}</el-avatar>
          <span class="qc-name">{{ b.name }}</span>
          <span class="qc-count num">{{ b.postCount }}</span>
        </div>
        <div class="quick-chip games" @click="goGames">
          <span class="qc-emoji">🕹️</span>
          <span class="qc-name">全部游戏</span>
        </div>
      </div>
    </section>

    <!-- 每日精选 & 本周热门 -->
    <section class="picks">
      <div class="picks-col">
        <div class="picks-head">⭐ 每日精选</div>
        <div v-if="dailyPicks.length" class="pick-list">
          <div
            v-for="p in dailyPicks"
            :key="p.id"
            class="pick-item"
            @click="goPost(p.id)"
          >
            <span class="pick-rank num">{{ p.boardName }}</span>
            <span class="pick-title">{{ p.title }}</span>
            <span class="pick-heat num">♥ {{ p.likeCount }}</span>
          </div>
        </div>
        <el-empty v-else :image-size="48" description="暂时还没有帖子哦，期待您的发帖！" />
      </div>
      <div class="picks-col">
        <div class="picks-head">🔥 本周热门</div>
        <div v-if="weeklyPicks.length" class="pick-list">
          <div
            v-for="p in weeklyPicks"
            :key="p.id"
            class="pick-item"
            @click="goPost(p.id)"
          >
            <span class="pick-rank num">{{ p.boardName }}</span>
            <span class="pick-title">{{ p.title }}</span>
            <span class="pick-heat num">♥ {{ p.likeCount }}</span>
          </div>
        </div>
        <el-empty v-else :image-size="48" description="暂时还没有帖子哦，期待您的发帖！" />
      </div>
    </section>

    <!-- 话题标签云 -->
    <section class="tagcloud">
      <div class="tc-head">🏷 热门话题</div>
      <div class="tc-list">
        <span
          v-for="t in tags"
          :key="t.id"
          class="tc-tag"
          @click="goTag(t.id)"
        >#{{ t.name }}<i class="tc-count num">{{ t.count }}</i></span>
      </div>
    </section>

    <!-- 帖子流 -->
    <div class="feed-head">
      <div class="feed-tabs">
        <button
          class="ftab"
          :class="{ on: feedTab === 'all' }"
          @click="feedTab = 'all'"
        >综合</button>
        <button
          class="ftab"
          :class="{ on: feedTab === 'following' }"
          @click="feedTab = 'following'"
        >关注</button>
      </div>
      <SortTabs v-model="sort" :disabled="sorting" class="feed-sort" />
    </div>

    <div v-if="loading && posts.length === 0" class="feed">
      <div v-for="n in 5" :key="n" class="sk-card">
        <el-skeleton :rows="2" animated />
      </div>
    </div>

    <div v-else class="feed">
      <PostCard v-for="p in posts" :key="p.id" :post="p" />
      <el-empty
        v-if="posts.length === 0"
        :description="feedTab === 'following' ? '你关注的人还没有发新帖～' : '这个排序下还没有帖子～'"
        :image-size="90"
      />

      <el-pagination
        v-if="total > PAGE_SIZE"
        class="pager"
        layout="prev, pager, next"
        :current-page="current"
        :page-size="PAGE_SIZE"
        :total="total"
        @current-change="onPage"
      />
    </div>
  </AppLayout>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Close } from '@element-plus/icons-vue'
import AppLayout from '@/layout/AppLayout.vue'
import SortTabs from '@/components/SortTabs.vue'
import PostCard from '@/components/PostCard.vue'
import AnnouncementModal from '@/components/AnnouncementModal.vue'
import { getPosts, getBoards, getHotTags, getAnnouncements, getDailyPicks, getWeeklyPicks, getHotGames, getFollowingFeed } from '@/api/community'
import { getSnap, setSnap } from '@/utils/swrCache'
import { useGameStore, useUserStore } from '@/store'

const router = useRouter()
const gameStore = useGameStore()
const userStore = useUserStore()
const PAGE_SIZE = 10
const sort = ref('latest')
const posts = ref([])
const total = ref(0)
const feedTab = ref('all') // 'all' 综合 / 'following' 关注流
const current = ref(1)
const loading = ref(false)
const sorting = ref(false)

// 公告弹窗：每个用户每个自然日，第一次进入综合首页时自动弹出一次
const annoVisible = ref(false)
const announcements = ref([])
/** localStorage key 前缀：按用户隔离，避免同一浏览器换账号后互相串数据 */
const ANNO_KEY_PREFIX = 'yumu_anno_daily_v3_'

/** 当前用户维度的存储 key；未登录时回落 guest（游客同样保证每天看一次） */
function annoKey() {
  const uid = userStore.userInfo?.id
  return ANNO_KEY_PREFIX + (uid != null ? uid : 'guest')
}

/** 本地自然日 YYYY-MM-DD（按浏览器时区，与用户体感的「今天」对齐） */
function todayStr() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * 「最新发布的公告 id」= 列表 max(id)。
 * 注意：后端排序是 sort DESC, id DESC（置顶优先），items[0] 可能是被置顶的**老公告**，
 * 因此不能用 items[0].id 代表最新发布，必须取 max(id)。
 */
function latestAnnouncementId(list) {
  return (list || []).reduce((max, a) => (a.id > max ? a.id : max), 0)
}

/** 读取该用户的弹窗记录；损坏时按「没弹过」处理，优先保证公告触达 */
function readAnnoSeen() {
  try {
    return JSON.parse(localStorage.getItem(annoKey()) || '{}') || {}
  } catch (e) {
    return {}
  }
}

/** 今天是否已经自动弹过 */
function hasShownToday() {
  const seen = readAnnoSeen()
  return !!seen.date && seen.date === todayStr()
}

/** 是否存在「上次关闭之后才发布」的新公告 */
function hasNewAnnouncement(list) {
  const seenMaxId = Number(readAnnoSeen().seenMaxId) || 0
  return latestAnnouncementId(list) > seenMaxId
}

async function loadAnnouncementsAndMaybeShow(force = false) {
  try {
    const list = await getAnnouncements(5)
    announcements.value = list || []
    if (!announcements.value.length) return
    // 触发条件（满足其一即弹，force 用于手动「再看一次」）：
    //   ① 今天还没弹过      → 每日一次
    //   ② 有更新的公告      → 新公告触达（同一条绝不重复弹，靠 seenMaxId 保证）
    const daily = !hasShownToday()
    const fresh = hasNewAnnouncement(announcements.value)
    if (!force && !daily && !fresh) return
    annoVisible.value = true
    if (import.meta.env.DEV) {
      console.info('[anno] popup trigger', {
        force, daily, fresh,
        date: todayStr(),
        uid: userStore.userInfo?.id ?? 'guest',
        latestId: latestAnnouncementId(announcements.value)
      })
    }
  } catch (e) { /* 静默 */ }
}

function onAnnoClose() {
  // 记录两项，分别约束两条触发规则：
  //   date      → 当天内不再因「每日一次」重复弹；自然日翻篇后自动再弹
  //   seenMaxId → 已看到的最新公告 id，只有**更新**的公告才能再触发
  try {
    localStorage.setItem(annoKey(), JSON.stringify({
      date: todayStr(),
      seenMaxId: latestAnnouncementId(announcements.value),
      at: Date.now()
    }))
  } catch (e) {
    // localStorage 不可用（隐私模式等）时静默失败，仅丢失「不重复弹」的记忆
  }
}
/** 暴露给模板：手动重新打开弹窗（用于再次查看公告） */
function reopenAnno() { loadAnnouncementsAndMaybeShow(true) }

// 顶部热门/侧边小卡
const heroPosts = ref([])
const sidePosts = ref([])
const heroIdx = ref(0)
let timer = null
const heroColors = [
  'linear-gradient(120deg, #7c5cff 0%, #19e3c2 100%)',
  'linear-gradient(120deg, #ff6b9a 0%, #7c5cff 100%)',
  'linear-gradient(120deg, #19e3c2 0%, #3b82f6 100%)',
  'linear-gradient(120deg, #f59e0b 0%, #ef4444 100%)'
]
const heroStyle = computed(() => {
  const c = heroColors[heroIdx.value % heroColors.length]
  return { background: c }
})

const boards = ref([])
const tags = ref([])
const dailyPicks = ref([])
const weeklyPicks = ref([])

function formatHeat(n) {
  return n >= 10000 ? (n / 10000).toFixed(1) + 'w' : (n || 0)
}

async function loadHot() {
  const data = await getPosts({ sort: 'hot', current: 1, size: 8 })
  const list = (data.records || []).map((p) => ({
    id: p.id,
    title: p.title,
    boardName: p.boardName,
    heat: (p.replyCount || 0) * 2 + (p.likeCount || 0)
  }))
  heroPosts.value = list.slice(0, 4)
  sidePosts.value = list.slice(4, 7)
  if (heroPosts.value.length) startCarousel()
}
function startCarousel() {
  stopCarousel()
  if (heroPosts.value.length > 1) {
    timer = setInterval(() => {
      heroIdx.value = (heroIdx.value + 1) % heroPosts.value.length
    }, 4500)
  }
}
function stopCarousel() {
  if (timer) clearInterval(timer)
  timer = null
}

// 1.2：热门板块入口改为「热门游戏」，点击进入对应游戏
// ★ 9-11：PC 端热门游戏改为「换行 + 居中」展示（不再横向滑动）。
//   数量取 7：加末尾的「全部游戏」= 8 个胶囊，在 PC 主视野（≥1366）下正好铺满两行，
//   且「全部游戏」落在第二行末位。取 10 会溢出成三行、取 5 则第二行留白过多。
//   完整游戏列表仍可从右侧「进入游戏库 ›」查看。
async function loadHotGames() {
  try {
    boards.value = await getHotGames(7)
  } catch (e) {
    boards.value = []
  }
}
async function loadTags() {
  tags.value = await getHotTags(12)
}
async function loadPicks() {
  try {
    dailyPicks.value = await getDailyPicks()
  } catch (e) {
    dailyPicks.value = []
  }
  try {
    weeklyPicks.value = await getWeeklyPicks()
  } catch (e) {
    weeklyPicks.value = []
  }
}

async function load(showSkeleton = true) {
  const key = `home:${feedTab.value}:${sort.value}:${gameStore.currentGameId || 'all'}:p${current.value}`
  // SWR 快照：跳回来先用上次数据立即渲染（不闪骨架），过期才后台静默刷新
  const snap = getSnap(key)
  if (snap) {
    applyFeed(snap.data)
    if (snap.fresh) return
  } else if (showSkeleton) {
    loading.value = true
  }
  try {
    let payload
    if (feedTab.value === 'following') {
      // 关注流：仅当前用户关注的人发的可见帖，支持排序二次筛选
      const data = await getFollowingFeed({ sort: sort.value, current: current.value, size: PAGE_SIZE })
      payload = { records: data.records, total: data.total, current: data.current }
    } else {
      // 综合动态：1.2 起选中游戏后仅展示该游戏帖子；未选中则全站
      const data = await getPosts({
        gameId: gameStore.currentGameId,
        sort: sort.value,
        current: current.value,
        size: PAGE_SIZE
      })
      payload = { records: data.records, total: data.total, current: data.current }
    }
    setSnap(key, payload)
    applyFeed(payload)
  } finally {
    if (showSkeleton) loading.value = false
  }
}

function applyFeed(payload) {
  posts.value = payload.records
  total.value = payload.total
  current.value = payload.current
}

function onPage(p) {
  current.value = p
  load()
}
function goPost(id) {
  if (id) router.push(`/post/${id}`)
}
function goBoard(id) {
  router.push(`/board/${id}`)
}
function goGames() {
  router.push('/games')
}
function goGame(id) {
  if (id) {
    const g = boards.value.find((x) => x.id === id)
    if (g) gameStore.setGame(g)
    router.push(`/game/${id}`)
  }
}
function goTag(id) {
  router.push(`/tag/${id}`)
}

onMounted(async () => {
  await Promise.all([loadHot(), loadHotGames(), loadTags(), load(), loadPicks(), loadAnnouncementsAndMaybeShow()])
})
onUnmounted(stopCarousel)
watch(sort, async () => {
  current.value = 1
  // 切换排序时保留旧列表，不弹骨架屏，只把排序 tab 置灰并静默拉取，避免闪屏
  sorting.value = true
  try {
    await load(false)
  } finally {
    sorting.value = false
  }
})
// 切换当前游戏时，综合动态重新拉取
watch(() => gameStore.currentGameId, () => {
  if (feedTab.value === 'all') {
    current.value = 1
    load()
  }
})
// 切换综合/关注 Tab
watch(feedTab, () => {
  current.value = 1
  load()
})
</script>

<style scoped>
/* ---------- Hero 大图区 ---------- */
.hero {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 268px;
  gap: 12px;
  margin-bottom: 16px;
}
.hero-stage,
.hero-empty {
  position: relative;
  min-height: 220px;
  border-radius: var(--radius);
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--border);
  transition: transform 0.2s;
}
.hero-stage:hover {
  transform: translateY(-2px);
}
.hero-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 30%, rgba(0, 0, 0, 0.55) 100%);
}
.hero-inner {
  position: absolute;
  left: 22px;
  right: 22px;
  bottom: 20px;
  z-index: 2;
}
.hero-badge {
  display: inline-block;
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  backdrop-filter: blur(4px);
}
.hero-title {
  margin: 10px 0 8px;
  color: #fff;
  font-size: 24px;
  font-weight: 800;
  line-height: 1.25;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.hero-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
}
.hero-board {
  background: rgba(255, 255, 255, 0.2);
  padding: 2px 9px;
  border-radius: 999px;
}
.hero-dots {
  position: absolute;
  left: 22px;
  top: 14px;
  display: flex;
  gap: 6px;
  z-index: 3;
}
.hero-dots .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  padding: 0;
}
.hero-dots .dot.on {
  background: #fff;
  width: 20px;
  border-radius: 999px;
}
.hero-side {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.side-card {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 9px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.side-card:hover {
  border-color: var(--brand);
  background: var(--bg-3);
}
.side-rank {
  flex: none;
  width: 20px;
  text-align: center;
  font-weight: 800;
  color: var(--t3);
  font-family: var(--font-num);
}
.side-rank.top {
  color: var(--accent);
}
.side-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--t1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.side-heat {
  flex: none;
  font-size: 11px;
  color: var(--t3);
}

/* ---------- 热门板块入口 ---------- */
.quick {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  margin-bottom: 14px;
}
.quick-head {
  font-size: 14px;
  font-weight: 700;
  color: var(--t1);
  margin-bottom: 10px;
}
/* ★ 9-11：PC 优先 —— 去掉横向滑动（overflow-x:auto 连同滚动条一起移除），
   改为自动换行 + 整块水平居中。行数由 loadHotGames() 的数量控制（最多两行）。 */
.quick-scroll {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 10px;
}
.quick-more {
  font-size: 12px;
  color: var(--brand);
  font-weight: 600;
  cursor: pointer;
  margin-left: 8px;
}
.quick-more:hover {
  text-decoration: underline;
}
.quick-chip.games {
  background: linear-gradient(135deg, rgba(124, 92, 255, 0.16), rgba(25, 227, 194, 0.12));
  border-color: rgba(124, 92, 255, 0.4);
}
.quick-chip.games:hover {
  border-color: var(--brand);
}
.quick-chip {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 12px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  max-width: 100%;
}
.quick-chip:hover {
  border-color: var(--brand);
  background: var(--brand-soft);
}
.qc-emoji {
  font-size: 16px;
  flex: none;
}
/* ★ 9-11：游戏名过长（如「崩坏：星穹铁道」）时截断省略，避免单个胶囊撑宽整行 */
.qc-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--t1);
  min-width: 0;
  max-width: 76px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qc-count {
  font-size: 11px;
  color: var(--brand);
  background: var(--brand-soft);
  padding: 1px 8px;
  border-radius: 999px;
  font-weight: 700;
  flex: none;
}

/* ★ 9-11：窄桌面（左栏 + 右栏都在，主区被压到 ~510px）时进一步收紧胶囊，
   保证 7 款游戏 + 全部游戏仍落在两行内，不冒出第三行。 */
/* ★ 9-11：热门游戏改拼音序后行首多为长名，收紧断点拆两档，保证 ≥1200px 恒为两行(4+4) */
@media (max-width: 1320px) {
  .quick-chip {
    padding: 5px 10px;
    gap: 5px;
  }
  .qc-name {
    max-width: 62px;
    font-size: 12.5px;
  }
  .qc-count {
    padding: 1px 6px;
  }
}
@media (max-width: 1240px) {
  .quick-chip {
    padding: 5px 9px;
  }
  .qc-name {
    max-width: 54px;
    font-size: 12px;
  }
  .quick-scroll {
    gap: 8px 8px;
  }
}

/* ---------- 话题标签云 ---------- */
.tagcloud {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  margin-bottom: 16px;
}
.tc-head {
  font-size: 14px;
  font-weight: 700;
  color: var(--t1);
  margin-bottom: 10px;
}
.tc-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tc-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 13px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-3);
  color: var(--t2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.tc-tag:hover {
  border-color: var(--brand);
  color: var(--brand);
}
.tc-count {
  font-size: 11px;
  color: var(--t3);
  font-style: normal;
}

/* ---------- 帖子流 ---------- */
.feed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  gap: 12px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 16px;
  margin-bottom: 16px;
  overflow: hidden;
}
.feed-tabs {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.ftab {
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--t2);
  font-size: 15px;
  font-weight: 600;
  padding: 8px 18px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.ftab:hover {
  border-color: var(--brand);
  color: var(--brand);
}
.ftab.on {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.feed-sort {
  flex: none;
}
.feed-sort :deep(.tabs) {
  flex-wrap: nowrap;
}
.feed-sort :deep(.tab) {
  padding: 7px 12px;
  font-size: 14.5px;
  font-weight: 600;
  white-space: nowrap;
}
.feed {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sk-card {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
}
.pager {
  justify-content: center;
  margin-top: 8px;
}
@media (max-width: 760px) {
  .hero {
    grid-template-columns: 1fr;
  }
  .hero-side {
    flex-direction: row;
    overflow-x: auto;
  }
  .side-card {
    min-width: 180px;
  }
}

/* ---------- 每日精选 / 本周热门 ---------- */
.picks {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 16px;
}
.picks-col {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  /* ★ 9-11：grid 子项默认 min-width:auto，会被最长标题的固有宽度顶开 →
     1fr 1fr 退化成「按内容分配」（实测 267px / 570px 两列不等宽），
     并把整个主内容区撑出横向滚动条。必须显式归零才会均分。 */
  min-width: 0;
}
.picks-head {
  font-size: 14px;
  font-weight: 700;
  color: var(--t1);
  margin-bottom: 10px;
}
.pick-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pick-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-2);
  cursor: pointer;
  transition: all 0.15s;
}
.pick-item:hover {
  border-color: var(--brand);
  background: var(--bg-3);
}
.pick-rank {
  flex: none;
  font-size: 11px;
  color: var(--brand);
  background: var(--brand-soft);
  padding: 1px 7px;
  border-radius: 999px;
  max-width: 92px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pick-title {
  flex: 1;
  /* ★ 9-11：flex 子项默认 min-width:auto → nowrap 的标题不肯收缩，
     省略号（text-overflow）根本没机会生效，文字直接顶出卡片外。 */
  min-width: 0;
  font-size: 13px;
  color: var(--t1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pick-heat {
  flex: none;
  font-size: 11px;
  color: var(--t3);
}
.pick-cur-tag {
  flex: none;
  font-size: 10px;
  font-weight: 700;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.14);
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}
@media (max-width: 760px) {
  .picks {
    grid-template-columns: 1fr;
  }
}
</style>

<template>
  <AppLayout :hide-rail="true">
    <BackButton />
    <div v-if="loading && !game" class="gd-loading"><el-skeleton :rows="8" animated /></div>
    <div v-else-if="!game" class="gd-empty">
      <el-empty description="游戏不存在或已下架" :image-size="90" />
    </div>
    <div v-else class="gd">
      <!-- 头部 Banner：上排 封面+简介+按钮 ｜ 下排 横向信息条（帖子数/版主头像/活跃玩家头像） -->
      <div class="gd-banner" :style="bannerStyle">
        <div class="gd-banner-top">
          <div class="gd-cover">
            <img v-if="game.cover" :src="game.cover" :alt="game.name" />
            <div v-else class="gd-cover-empty">🎮</div>
          </div>
          <div class="gd-info">
            <h1 class="gd-name">{{ game.name }}</h1>
            <div class="gd-tags">
              <span v-if="game.platform" class="gd-tag platform">{{ game.platform }}</span>
              <span v-if="game.genre" class="gd-tag genre">{{ game.genre }}</span>
              <span v-if="game.releaseDate" class="gd-tag">{{ game.releaseDate }} 发售</span>
            </div>
            <p class="gd-desc">{{ game.description || '暂无简介' }}</p>
            <div class="gd-meta num">
              <span v-if="game.developer">开发：{{ game.developer }}</span>
              <span v-if="game.publisher">发行：{{ game.publisher }}</span>
            </div>
            <div class="gd-actions">
              <el-button type="primary" @click="goEditor(game.id)">💬 加入讨论</el-button>
              <el-button @click="goGameLib">🎮 游戏库</el-button>
            </div>
          </div>
        </div>

        <!-- 横向信息条：帖子数 / 版主头像 / 活跃玩家头像 -->
        <div class="gd-stats-bar">
          <div class="stat-cell">
            <span class="stat-ico">💬</span>
            <span class="stat-val">{{ game.postCount }}</span>
            <span class="stat-lbl">篇讨论</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-cell stat-cell-flex">
            <span class="stat-ico">🛡️</span>
            <span class="stat-lbl">版主</span>
            <div v-if="moderators.length" class="stat-avatars" @click="openModsDialog = true">
              <el-avatar
                v-for="m in displayMods"
                :key="m.id"
                :size="28"
                :src="m.avatar"
                class="stat-av"
                @click.stop="goUser(m.id)"
              >{{ (m.nickname || '版').charAt(0) }}</el-avatar>
              <span v-if="moderators.length > displayMods.length" class="stat-more">+{{ moderators.length - displayMods.length }}</span>
              <span class="stat-total">{{ moderators.length }} 位</span>
            </div>
            <div v-else class="stat-empty warn">暂无版主，帖子由管理员审核</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-cell stat-cell-flex">
            <span class="stat-ico">🏆</span>
            <span class="stat-lbl">活跃玩家</span>
            <div v-if="activeUsers.length" class="stat-avatars" @click="openActiveDialog = true">
              <el-avatar
                v-for="u in displayActiveUsers"
                :key="u.id"
                :size="28"
                :src="u.avatar"
                class="stat-av"
                @click.stop="goUser(u.id)"
              >{{ (u.nickname || '玩').charAt(0) }}</el-avatar>
              <span v-if="activeUsers.length > displayActiveUsers.length" class="stat-more">+{{ activeUsers.length - displayActiveUsers.length }}</span>
              <span class="stat-total">{{ activeUsers.length }} 位</span>
            </div>
            <div v-else class="stat-empty">还没有玩家在这里讨论</div>
          </div>
        </div>
      </div>

      <!-- 全部讨论 -->
      <div class="gd-section">
        <div class="gd-sec-head">
          <h2 class="gd-sec-title">📣 全部讨论</h2>
        </div>

        <div class="gd-filter-bar">
          <SortTabs v-model="sort" />
        </div>

        <div v-if="postsLoading" class="gd-feed">
          <div v-for="n in 3" :key="n" class="gd-sk"><el-skeleton :rows="2" animated /></div>
        </div>
        <div v-else-if="!posts.length" class="gd-empty-feed">
          <el-empty description="还没有人聊这款游戏，抢个沙发？" :image-size="80" />
        </div>
        <div v-else class="gd-feed">
          <PostCard v-for="p in posts" :key="p.id" :post="p" />
          <el-pagination
            v-if="postTotal > postSize"
            class="gd-page"
            layout="prev, pager, next"
            :current-page="postCurrent"
            :page-size="postSize"
            :total="postTotal"
            @current-change="onPostPage"
          />
        </div>
      </div>
    </div>

    <!-- 版主完整列表弹窗 -->
    <el-dialog v-model="openModsDialog" title="🛡️ 版主列表" width="440px" :show-close="true">
      <ul v-if="moderators.length" class="dialog-mod-list">
        <li v-for="m in moderators" :key="m.id" class="mod" @click="goUser(m.id); openModsDialog = false">
          <el-avatar :size="36" :src="m.avatar">{{ (m.nickname || '版').charAt(0) }}</el-avatar>
          <div class="mod-meta">
            <div class="mod-name">{{ m.nickname }}</div>
            <div class="mod-sub">{{ m.postCount || 0 }} 帖 · {{ m.activityTitle }}</div>
          </div>
        </li>
      </ul>
      <div v-else class="side-empty warn">该游戏暂无版主，帖子由管理员审核</div>
    </el-dialog>

    <!-- 活跃玩家完整列表弹窗 -->
    <el-dialog v-model="openActiveDialog" title="🏆 活跃玩家" width="440px" :show-close="true">
      <ul v-if="activeUsers.length" class="dialog-active-list">
        <li v-for="u in activeUsers" :key="u.id" class="mod" @click="goUser(u.id); openActiveDialog = false">
          <el-avatar :size="36" :src="u.avatar">{{ (u.nickname || '玩').charAt(0) }}</el-avatar>
          <div class="mod-meta">
            <div class="mod-name">{{ u.nickname }}</div>
            <div class="mod-sub">{{ u.postCount }} 帖 · {{ u.activityTitle }}</div>
          </div>
        </li>
      </ul>
      <div v-else class="side-empty">还没有玩家在这里讨论</div>
    </el-dialog>
  </AppLayout>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '@/layout/AppLayout.vue'
import BackButton from '@/components/BackButton.vue'
import SortTabs from '@/components/SortTabs.vue'
import PostCard from '@/components/PostCard.vue'
import { getGameDetail, getPosts, getGameActiveUsers, getGameModerators } from '@/api/community'
import { useGameStore } from '@/store'

const route = useRoute()
const router = useRouter()
const gameStore = useGameStore()
const game = ref(null)
const loading = ref(false)

// Banner 侧栏数据
const moderators = ref([])
const activeUsers = ref([])

// 全部讨论
const posts = ref([])
const postsLoading = ref(false)
const postTotal = ref(0)
const postCurrent = ref(1)
const postSize = ref(20)
// 1.2 起：游戏专区页「具体板块筛选」移交给左侧栏板块分类导航，
// 这里只按游戏 + 排序加载全游戏讨论，不再需要 activeBoard。
const sort = ref('latest')

const gameId = ref(null)

const bannerStyle = computed(() => {
  if (game.value && game.value.cover) {
    return {
      backgroundImage: `linear-gradient(120deg, rgba(17,24,39,.88), rgba(17,24,39,.5)), url(${game.value.cover})`
    }
  }
  return {}
})

// Banner 侧栏限上限，防测试版主/大量活跃玩家撑爆侧栏
const displayMods = computed(() => moderators.value.slice(0, 3))
const displayActiveUsers = computed(() => activeUsers.value.slice(0, 4))

// 弹窗状态
const openModsDialog = ref(false)
const openActiveDialog = ref(false)

async function loadGame() {
  loading.value = true
  try {
    game.value = await getGameDetail(gameId.value)
    if (game.value) gameStore.setGame(game.value)
  } finally {
    loading.value = false
  }
}
async function loadActive() {
    activeUsers.value = await getGameActiveUsers(gameId.value, 5)
}
async function loadModerators() {
    moderators.value = await getGameModerators(gameId.value)
}
async function loadBannerExtras() {
  await Promise.allSettled([loadActive(), loadModerators()])
}
async function loadPosts() {
  postsLoading.value = true
  try {
    const data = await getPosts({
      gameId: gameId.value,
      // 全游戏讨论；具体板块从左侧栏进入
      boardId: null,
      sort: sort.value,
      current: postCurrent.value,
      size: postSize.value
    })
    posts.value = data.records
    postTotal.value = data.total
  } finally {
    postsLoading.value = false
  }
}
function onPostPage(p) {
  postCurrent.value = p
  loadPosts()
}
function goPost(id) {
  router.push(`/post/${id}`)
}
function goUser(id) {
  router.push(`/user/${id}`)
}
function goEditor(id) {
  router.push(`/editor?gameId=${id}`)
}
function goGameLib() {
  router.push('/games')
}

function loadAll() {
  loadGame()
  loadBannerExtras()
  loadPosts()
}

watch(
  () => route.params.id,
  (id) => {
    if (id) {
      gameId.value = id
      postCurrent.value = 1
      loadAll()
    }
  }
)
watch([sort], () => {
  postCurrent.value = 1
  loadPosts()
})

onMounted(() => {
  gameId.value = route.params.id
  loadAll()
})
</script>

<style scoped>
.gd {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px 22px;
  min-width: 0;
}
.gd-loading,
.gd-empty {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 40px 22px;
}

/* Banner */
.gd-banner {
  margin: -18px -20px 0;
  padding: 34px 28px;
  border-radius: var(--radius) var(--radius) 0 0;
  background: linear-gradient(120deg, #2a1d5e, #0f3b39);
  background-size: cover;
  background-position: center;
  color: #fff;
}
.gd-banner-top {
  display: flex;
  gap: 22px;
  align-items: flex-start;
}
.gd-cover {
  flex: none;
  width: 150px;
  height: 200px;
  border-radius: 14px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.12);
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.25);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
}
.gd-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.gd-cover-empty {
  font-size: 56px;
}
.gd-info {
  flex: 1;
  min-width: 0;
}
.gd-name {
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: 800;
  color: #fff;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}
.gd-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.gd-tag {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 11px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #e8e8f5;
}
.gd-tag.platform {
  background: rgba(124, 92, 255, 0.55);
  color: #fff;
}
.gd-tag.genre {
  background: rgba(25, 227, 194, 0.45);
  color: #042;
}
.gd-desc {
  font-size: 14px;
  line-height: 1.7;
  margin: 0 0 12px;
  color: rgba(255, 255, 255, 0.9);
  max-width: 720px;
}
.gd-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.78);
  margin-bottom: 16px;
}
.gd-actions {
  display: flex;
  gap: 10px;
}

/* 横向信息条：取代原右侧纵向三块，避免把 Banner 撑高 */
.gd-stats-bar {
  margin-top: 16px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  color: #fff;
}
.stat-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
}
.stat-cell-flex {
  flex: 1 1 auto;
  min-width: 200px;
}
.stat-ico {
  font-size: 14px;
}
.stat-val {
  font-size: 17px;
  font-weight: 800;
  color: #19e3c2;
}
.stat-lbl {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
}
.stat-divider {
  width: 1px;
  height: 22px;
  background: rgba(255, 255, 255, 0.18);
  flex: none;
}
.stat-avatars {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  flex: 1 1 auto;
  min-width: 0;
  flex-wrap: nowrap;
  overflow: hidden;
}
.stat-av {
  border: 1.5px solid rgba(255, 255, 255, 0.3);
  transition: transform 0.15s, border-color 0.15s;
  cursor: pointer;
}
.stat-av:hover {
  transform: translateY(-2px);
  border-color: #19e3c2;
}
.stat-more {
  font-size: 11.5px;
  font-weight: 700;
  color: #19e3c2;
  background: rgba(25, 227, 194, 0.15);
  padding: 1px 8px;
  border-radius: 999px;
}
.stat-total {
  margin-left: 4px;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.7);
}
.stat-empty {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  font-style: italic;
}
.stat-empty.warn {
  font-style: normal;
  color: #ffd27a;
}

/* 弹窗：版主 / 活跃玩家完整列表（浅色卡片，深色文字适配 el-dialog 默认浅底） */
.dialog-mod-list,
.dialog-active-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 60vh;
  overflow-y: auto;
  /* 弹窗底部留一点空白，避免最后一项贴边 */
  padding-bottom: 4px;
}
.mod {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  padding: 10px 14px;
  border-radius: 10px;
  background: #f5f7fa;
  border: 1px solid #ebeef5;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
  color: #303133;
}
.mod:hover {
  background: #ecf5ff;
  border-color: #b3d8ff;
  transform: translateX(2px);
}
.mod-meta {
  min-width: 0;
  flex: 1;
}
.mod-name {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dialog-active-list .mod-sub {
  font-size: 12px;
  color: #909399;
  margin-top: 0;
}
.dialog-mod-list .mod-sub {
  font-size: 12px;
  color: #909399;
  margin-top: 0;
}
/* 兜底空列表（仍可能出现在侧栏 fallback） */
.side-empty {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  font-style: italic;
  padding: 6px 2px;
}
.side-empty.warn {
  font-style: normal;
  color: #ffd27a;
  line-height: 1.5;
}

/* 全部讨论 */
.gd-section {
  border-top: 1px solid var(--border);
  padding-top: 18px;
}
/* 「全部」筛选 + 排序行：同一行并排，节省纵向空间（chip 样式由 SortTabs 内部管） */
.gd-filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}
.gd-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.gd-sec-title {
  margin: 0;
  font-size: 17px;
  font-weight: 800;
  color: var(--t1);
}
.gd-feed {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.gd-sk {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
}
.gd-empty-feed {
  padding: 20px 0;
}
.gd-page {
  justify-content: center;
  margin-top: 8px;
}

@media (max-width: 1080px) {
  .gd-banner-top {
    flex-wrap: wrap;
  }
  .gd-cover {
    width: 120px;
    height: 160px;
  }
}
@media (max-width: 720px) {
  .gd-banner-top {
    flex-direction: column;
    align-items: stretch;
  }
  .gd-cover {
    width: 100%;
    height: 180px;
  }
  .gd-stats-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .stat-divider {
    width: 100%;
    height: 1px;
  }
  .stat-cell-flex {
    min-width: 0;
  }
}
</style>
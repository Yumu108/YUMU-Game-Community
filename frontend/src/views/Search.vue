<template>
  <AppLayout>
    <div class="search-head">
      <div class="bar">
        <el-icon class="b-icon"><Search /></el-icon>
        <input
          v-model="keyword"
          class="b-input"
          placeholder="搜索游戏、攻略、玩家…"
          @keyup.enter="run"
        />
        <el-button type="primary" round @click="run">搜索</el-button>
      </div>
      <div class="kw">“<b>{{ route.query.keyword }}</b>” 的搜索结果</div>

      <el-tabs v-model="tab" class="tabs" @tab-change="onTabChange">
        <el-tab-pane label="综合" name="all" />
        <el-tab-pane label="帖子" name="post" />
        <el-tab-pane label="板块" name="board" />
        <el-tab-pane label="玩家" name="user" />
        <el-tab-pane label="游戏" name="game" />
      </el-tabs>
    </div>

    <!-- 加载 -->
    <el-skeleton v-if="loading" :rows="6" animated />

    <!-- 综合：聚合视图，每类前 3 条 + "查看全部 N 条 →" -->
    <div v-else-if="tab === 'all'" class="agg">
      <!-- 玩家 -->
      <section v-if="users.length" class="agg-group">
        <div class="agg-head">
          <span class="agg-title">👥 玩家</span>
          <a class="agg-more" @click="goto('user')">查看全部 {{ users.length }} 条 →</a>
        </div>
        <div class="agg-list">
          <div v-for="u in users.slice(0, 3)" :key="u.id" class="user">
            <el-avatar :size="40" class="u-ava" :src="u.avatar" @click="goUser(u.id)">{{ (u.name || '游').charAt(0) }}</el-avatar>
            <div class="u-info" @click="goUser(u.id)">
              <div class="u-name">{{ u.name }}</div>
              <div class="u-bio">{{ u.bio || '这个人很神秘，什么都没留下' }}</div>
            </div>
            <el-button size="small" round plain @click="goUser(u.id)">查看</el-button>
          </div>
        </div>
      </section>

      <!-- 帖子 -->
      <section v-if="postsPage.records.length" class="agg-group">
        <div class="agg-head">
          <span class="agg-title">📝 帖子</span>
          <a class="agg-more" @click="goto('post')">查看全部 {{ postsPage.total }} 条 →</a>
        </div>
        <div class="agg-list">
          <PostCard v-for="p in postsPage.records.slice(0, 3)" :key="p.id" :post="p" />
        </div>
      </section>

      <!-- 游戏 -->
      <section v-if="games.length" class="agg-group">
        <div class="agg-head">
          <span class="agg-title">🎮 游戏</span>
          <a class="agg-more" @click="goto('game')">查看全部 {{ games.length }} 条 →</a>
        </div>
        <div class="agg-grid">
          <router-link
            v-for="g in games.slice(0, 3)"
            :key="g.id"
            :to="`/game/${g.id}`"
            class="board"
          >
            <div class="b-emoji">🎮</div>
            <div class="b-info">
              <div class="b-name">{{ g.name }}</div>
              <div class="b-desc">{{ g.description || (g.genre || '暂无简介') }}</div>
              <div class="b-count num">{{ g.postCount || 0 }} 帖</div>
            </div>
          </router-link>
        </div>
      </section>

      <!-- 板块 -->
      <section v-if="boards.length" class="agg-group">
        <div class="agg-head">
          <span class="agg-title">🗂 板块</span>
          <a class="agg-more" @click="goto('board')">查看全部 {{ boards.length }} 条 →</a>
        </div>
        <div class="agg-grid">
          <router-link
            v-for="b in boards.slice(0, 3)"
            :key="b.id"
            :to="`/board/${b.id}`"
            class="board"
          >
            <div class="b-emoji">{{ b.emoji || '🎯' }}</div>
            <div class="b-info">
              <div class="b-name">{{ b.name }}</div>
              <div class="b-desc">{{ b.desc || '暂无简介' }}</div>
              <div class="b-count num">{{ b.postCount }} 帖</div>
            </div>
          </router-link>
        </div>
      </section>

      <el-empty v-if="allEmpty" description="没有找到相关内容～" :image-size="90" />
    </div>

    <!-- 帖子（单类型 tab，带分页） -->
    <div v-else-if="tab === 'post'">
      <PostCard v-for="p in postsPage.records" :key="p.id" :post="p" />
      <el-empty v-if="postsPage.records.length === 0" description="没有找到相关帖子～" :image-size="90" />
      <el-pagination
        v-if="postsPage.total > postsPage.size"
        class="pager"
        layout="prev, pager, next"
        :current-page="postsPage.current"
        :page-size="postsPage.size"
        :total="postsPage.total"
        @current-change="onPage"
      />
    </div>

    <!-- 板块 -->
    <div v-else-if="tab === 'board'" class="grid">
      <router-link
        v-for="b in boards"
        :key="b.id"
        :to="`/board/${b.id}`"
        class="board"
      >
        <div class="b-emoji">{{ b.emoji || '🎯' }}</div>
        <div class="b-info">
          <div class="b-name">{{ b.name }}</div>
          <div class="b-desc">{{ b.desc || '暂无简介' }}</div>
          <div class="b-count num">{{ b.postCount }} 帖</div>
        </div>
      </router-link>
      <el-empty v-if="boards.length === 0" description="没有找到相关板块～" :image-size="90" />
    </div>

    <!-- 玩家 -->
    <div v-else-if="tab === 'user'" class="users">
      <div v-for="u in users" :key="u.id" class="user">
        <el-avatar :size="40" class="u-ava" :src="u.avatar" @click="goUser(u.id)">{{ (u.name || '游').charAt(0) }}</el-avatar>
        <div class="u-info" @click="goUser(u.id)">
          <div class="u-name">{{ u.name }}</div>
          <div class="u-bio">{{ u.bio || '这个人很神秘，什么都没留下' }}</div>
        </div>
        <el-button size="small" round plain @click="goUser(u.id)">查看</el-button>
      </div>
      <el-empty v-if="users.length === 0" description="没有找到相关玩家～" :image-size="90" />
    </div>

    <!-- 游戏 -->
    <div v-else-if="tab === 'game'" class="grid">
      <router-link
        v-for="g in games"
        :key="g.id"
        :to="`/game/${g.id}`"
        class="board"
      >
        <div class="b-emoji">🎮</div>
        <div class="b-info">
          <div class="b-name">
            {{ g.name }}
            <el-tag v-if="g.platform" size="small" effect="plain" class="b-tag">{{ g.platform }}</el-tag>
          </div>
          <div class="b-desc">{{ g.description || (g.genre || '暂无简介') }}</div>
          <div class="b-count num">{{ g.postCount || 0 }} 帖</div>
        </div>
      </router-link>
      <el-empty v-if="games.length === 0" description="没有找到相关游戏～" :image-size="90" />
    </div>
  </AppLayout>
</template>

<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '@/layout/AppLayout.vue'
import PostCard from '@/components/PostCard.vue'
import { search } from '@/api/community'

const route = useRoute()
const router = useRouter()

const keyword = ref(route.query.keyword || '')
const tab = ref(route.query.type && ['all', 'post', 'board', 'user', 'game'].includes(route.query.type) ? route.query.type : 'all')
const loading = ref(false)
const postsPage = ref({ records: [], total: 0, pages: 0, current: 1, size: 10 })
const boards = ref([])
const users = ref([])
const games = ref([])

// 综合 tab 是否全部为空（用于显示兜底空态）
const allEmpty = computed(() =>
  users.value.length === 0 &&
  postsPage.value.records.length === 0 &&
  games.value.length === 0 &&
  boards.value.length === 0
)

async function run() {
  const kw = keyword.value.trim()
  if (!kw) {
    postsPage.value = { records: [], total: 0, pages: 0, current: 1, size: 10 }
    boards.value = []
    users.value = []
    games.value = []
    return
  }
  loading.value = true
  try {
    const data = await search({ keyword: kw, type: tab.value, current: postsPage.value.current, size: 10 })
    if (tab.value === 'post') {
      postsPage.value = data.postsPage
    } else if (tab.value === 'board') {
      boards.value = data.boards
    } else if (tab.value === 'user') {
      users.value = data.users
    } else if (tab.value === 'game') {
      games.value = data.games
    } else {
      // 综合：每类都有数据；统一赋值便于聚合视图渲染
      postsPage.value = data.postsPage || { records: [], total: 0, pages: 0, current: 1, size: 10 }
      boards.value = data.boards || []
      users.value = data.users || []
      games.value = data.games || []
    }
  } finally {
    loading.value = false
  }
}

function onTabChange(name) {
  // 切换 tab 时复位分页并同步 URL
  postsPage.value.current = 1
  router.replace({ query: { ...route.query, type: name } })
  run()
}

function onPage(p) {
  postsPage.value.current = p
  run()
}

function goUser(id) {
  router.push(`/user/${id}`)
}

// 「查看全部 N 条 →」点击 → 跳到对应单类型 tab
function goto(t) {
  tab.value = t
  // 不调用 onTabChange（避免 URL 触发两次 run），直接同步 URL 并重搜
  router.replace({ query: { ...route.query, type: t } })
  postsPage.value.current = 1
  run()
}

// 顶栏带 keyword 进入时，自动搜一次
onMounted(run)
// 顶栏切换 keyword 时重新搜
watch(() => route.query.keyword, (k) => {
  keyword.value = k || ''
  postsPage.value.current = 1
  run()
})
</script>

<style scoped>
.search-head {
  margin-bottom: 14px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 8px 6px 16px;
}
.b-icon {
  color: var(--t3);
}
.b-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--t1);
  font-size: 14px;
}
.kw {
  margin: 12px 2px 4px;
  font-size: 13px;
  color: var(--t2);
}
.kw b {
  color: var(--brand);
}
.tabs {
  margin-top: 4px;
}
.pager {
  justify-content: center;
  margin-top: 14px;
}

/* ========== 聚合视图（综合 tab） ========== */
.agg {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.agg-group {
  background: transparent;
}
.agg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 6px 2px 8px;
}
.agg-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--t1);
}
.agg-more {
  font-size: 12.5px;
  color: var(--brand);
  cursor: pointer;
  user-select: none;
}
.agg-more:hover {
  text-decoration: underline;
}
.agg-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.agg-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

/* ========== 玩家 ========== */
.users {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.user {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
}
.u-ava {
  background: var(--bg-3);
  flex: none;
}
.u-info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.u-name {
  font-weight: 700;
  color: var(--t1);
  font-size: 14px;
}
.u-bio {
  font-size: 12.5px;
  color: var(--t3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ========== 板块 / 游戏 卡片网格 ========== */
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.board {
  display: flex;
  gap: 12px;
  align-items: center;
  text-decoration: none;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px;
  transition: border-color 0.15s;
}
.board:hover {
  border-color: var(--brand);
}
.b-emoji {
  font-size: 28px;
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  background: var(--bg-1);
  border-radius: 12px;
  flex: none;
}
.b-info {
  min-width: 0;
}
.b-name {
  font-weight: 700;
  color: var(--t1);
  font-size: 14.5px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.b-tag {
  background: var(--bg-3) !important;
  color: var(--t2) !important;
  border-color: var(--border) !important;
  font-size: 10.5px !important;
  padding: 0 6px !important;
  height: 18px !important;
  line-height: 16px !important;
}
.b-desc {
  font-size: 12.5px;
  color: var(--t3);
  margin: 3px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.b-count {
  font-size: 11.5px;
  color: var(--brand);
}
</style>
<template>
  <AppLayout>
    <BackButton />
    <div class="games">
      <div class="g-head">
        <h1 class="g-title">🎮 游戏库</h1>
        <p class="g-sub">收录热门与经典游戏，点进去看社区里关于它的全部讨论、攻略与二创。</p>
      </div>

      <!-- 筛选 / 搜索 -->
      <div class="g-filters">
        <el-input
          v-model="keyword"
          class="g-search"
          placeholder="搜索游戏名 / 厂商"
          clearable
          @keyup.enter="onSearch"
          @clear="onSearch"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="platform" placeholder="平台" clearable class="g-sel" @change="onSearch">
          <el-option v-for="p in platformOptions" :key="p" :label="p" :value="p" />
        </el-select>
        <el-select v-model="genre" placeholder="类型" clearable class="g-sel" @change="onSearch">
          <el-option v-for="g in genreOptions" :key="g" :label="g" :value="g" />
        </el-select>
      </div>

      <div v-if="loading && games.length === 0" class="g-grid">
        <div v-for="n in 8" :key="n" class="g-card sk"><el-skeleton :rows="3" animated /></div>
      </div>
      <div v-else-if="games.length === 0" class="g-empty">
        <el-empty description="没有找到匹配的游戏，换个关键词试试～" :image-size="90" />
      </div>
      <div v-else class="g-grid">
        <div
          v-for="g in games"
          :key="g.id"
          class="g-card"
          @click="goGame(g.id)"
        >
          <div class="g-cover">
            <img v-if="g.cover" :src="g.cover" :alt="g.name" />
            <div v-else class="g-cover-empty">🎮</div>
            <span v-if="g.platform" class="g-platform">{{ g.platform }}</span>
          </div>
          <div class="g-body">
            <div class="g-name">{{ g.name }}</div>
            <div v-if="g.genre" class="g-genre">
              <span class="g-tag">{{ g.genre }}</span>
            </div>
            <p class="g-desc">{{ g.description || '暂无简介' }}</p>
            <div class="g-meta num">
              <span>💬 {{ g.postCount }} 帖</span>
              <span v-if="g.developer" class="g-dev">{{ g.developer }}</span>
            </div>
          </div>
        </div>
      </div>

      <el-pagination
        v-if="total > size"
        class="g-page"
        layout="prev, pager, next"
        :current-page="current"
        :page-size="size"
        :total="total"
        @current-change="onPage"
      />
    </div>
  </AppLayout>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import AppLayout from '@/layout/AppLayout.vue'
import BackButton from '@/components/BackButton.vue'
import { getGames } from '@/api/community'
import { useGameStore } from '@/store'

const router = useRouter()
const gameStore = useGameStore()
const keyword = ref('')
const platform = ref('')
const genre = ref('')
const games = ref([])
const platformOptions = ref([])
const genreOptions = ref([])
const total = ref(0)
const current = ref(1)
const size = ref(12)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await getGames({
      keyword: keyword.value,
      platform: platform.value,
      genre: genre.value,
      current: current.value,
      size: size.value
    })
    games.value = data.records
    total.value = data.total
    current.value = data.current
    // 用已加载数据推导可筛选维度（无需硬编码，永远与后端一致）
    const ps = new Set()
    const gs = new Set()
    games.value.forEach((g) => {
      if (g.platform) ps.add(g.platform)
      if (g.genre) gs.add(g.genre)
    })
    platformOptions.value = [...ps]
    genreOptions.value = [...gs]
  } finally {
    loading.value = false
  }
}
function onSearch() {
  current.value = 1
  load()
}
function onPage(p) {
  current.value = p
  load()
}
function goGame(id) {
  if (id) {
    // 1.2：进入游戏即写入全局选中游戏，驱动首页/板块/发帖的游戏维度
    const g = games.value.find((x) => x.id === id)
    if (g) gameStore.setGame(g)
    router.push(`/game/${id}`)
  }
}

onMounted(load)
</script>

<style scoped>
.games {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 22px;
}
.g-head {
  margin-bottom: 16px;
}
.g-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 800;
  color: var(--t1);
}
.g-sub {
  margin: 0;
  font-size: 13px;
  color: var(--t3);
  line-height: 1.6;
}
.g-filters {
  display: flex;
  gap: 10px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.g-search {
  flex: 1;
  min-width: 220px;
}
.g-sel {
  width: 140px;
}
.g-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.g-card {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.15s, border-color 0.15s;
}
.g-card:hover {
  transform: translateY(-3px);
  border-color: var(--brand);
}
.g-cover {
  position: relative;
  height: 120px;
  background: linear-gradient(135deg, rgba(124, 92, 255, 0.25), rgba(25, 227, 194, 0.18));
  display: grid;
  place-items: center;
  overflow: hidden;
}
.g-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.g-cover-empty {
  font-size: 40px;
}
.g-platform {
  position: absolute;
  left: 8px;
  top: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
}
.g-body {
  padding: 12px 14px 14px;
}
.g-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--t1);
  margin-bottom: 6px;
}
.g-genre {
  margin-bottom: 6px;
}
.g-tag {
  display: inline-block;
  font-size: 11px;
  color: var(--brand);
  background: var(--brand-soft);
  padding: 1px 8px;
  border-radius: 999px;
  font-weight: 600;
}
.g-desc {
  font-size: 12.5px;
  color: var(--t3);
  line-height: 1.5;
  margin: 0 0 10px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 38px;
}
.g-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--t3);
}
.g-dev {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.g-page {
  justify-content: center;
  margin-top: 16px;
}
.sk {
  padding: 12px;
}
</style>

<template>
  <AppLayout>
    <BackButton />
    <div v-if="boardMeta" class="board-head">
      <div class="b-info">
        <div class="b-emoji">{{ boardMeta.emoji }}</div>
        <div>
          <h2 class="b-name">
            {{ boardMeta.name }}
            <span v-if="gameStore.hasGame" class="b-game">· {{ gameStore.currentGame.name }}</span>
          </h2>
          <p class="b-desc">{{ boardMeta.desc }}</p>
        </div>
      </div>
      <!-- 1.2 收尾：按用户要求移除大数字"X 帖子"，避免与 gameStore 联动的口径错位 -->
    </div>

    <div class="feed-head">
      <SortTabs v-model="sort" />
      <span v-if="gameStore.hasGame" class="feed-game">
        仅看 <b>{{ gameStore.currentGame.name }}</b>
        <el-icon class="feed-game-clear" @click="gameStore.clearGame()"><Close /></el-icon>
      </span>
    </div>

    <!-- 骨架屏：首次加载且暂无数据时 -->
    <div v-if="loading && posts.length === 0" class="feed">
      <div v-for="n in 5" :key="n" class="sk-card">
        <el-skeleton :rows="2" animated />
      </div>
    </div>

    <div v-else class="feed">
      <PostCard v-for="p in posts" :key="p.id" :post="p" />
      <el-empty
        v-if="posts.length === 0"
        description="这个板块还没有帖子，来发第一帖吧～"
        :image-size="90"
      />

      <el-pagination
        v-if="total > pageSize"
        class="pager"
        layout="prev, pager, next"
        :current-page="current"
        :page-size="pageSize"
        :total="total"
        @current-change="onPage"
      />
    </div>
  </AppLayout>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import { Close } from '@element-plus/icons-vue'
import AppLayout from '@/layout/AppLayout.vue'
import BackButton from '@/components/BackButton.vue'
import SortTabs from '@/components/SortTabs.vue'
import PostCard from '@/components/PostCard.vue'
import { getBoard, getPosts } from '@/api/community'
import { getSnap, setSnap } from '@/utils/swrCache'
import { useGameStore } from '@/store'
import { findBoard } from '@/constants/boards'

const PAGE_SIZE = 10
const route = useRoute()
const gameStore = useGameStore()
const boardId = computed(() => route.params.id)
// 1.2：板块元信息来自固定常量（六种分类）
const boardMeta = computed(() => findBoard(boardId.value))
const board = ref(null)
const sort = ref('latest')
const posts = ref([])
const total = ref(0)
const current = ref(1)
const loading = ref(false)

async function load() {
  const id = boardId.value
  if (!id) return
  // SWR 快照：跳回来时先用上次的数据立即渲染（不闪骨架），
  // 60s 内视为新鲜直接不再请求；过期则后台静默刷新
  const key = `board:${id}:${sort.value}:${gameStore.currentGameId || 'all'}:p${current.value}`
  const snap = getSnap(key)
  if (snap) {
    applyData(snap.data)
    if (snap.fresh) return
  } else {
    loading.value = true
  }
  try {
    const [b, data] = await Promise.all([
      getBoard(id),
      getPosts({
        boardId: id,
        gameId: gameStore.currentGameId,
        sort: sort.value,
        current: current.value,
        size: PAGE_SIZE
      })
    ])
    const payload = { board: b, records: data.records, total: data.total, current: data.current }
    setSnap(key, payload)
    applyData(payload)
  } finally {
    loading.value = false
  }
}

function applyData(payload) {
  board.value = payload.board
  posts.value = payload.records
  total.value = payload.total
  current.value = payload.current
}

function onPage(p) {
  current.value = p
  load()
}

// watch 带 immediate: true，挂载时已触发首次 load —— 不再需要 onMounted 重复请求
// （此前 onMounted + immediate watch 会导致同一份列表数据并发请求两次）
watch(
  () => [route.params.id, sort.value, gameStore.currentGameId],
  () => {
    current.value = 1
    load()
  },
  { immediate: true }
)
</script>

<style scoped>
.board-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(135deg, rgba(124, 92, 255, 0.12), rgba(25, 227, 194, 0.08));
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 18px;
  margin-bottom: 16px;
}
.b-info {
  display: flex;
  align-items: center;
  gap: 14px;
}
.b-emoji {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--bg-2);
  display: grid;
  place-items: center;
  font-size: 26px;
  border: 1px solid var(--border);
}
.b-name {
  margin: 0 0 3px;
  font-size: 18px;
  font-weight: 800;
  color: var(--t1);
}
.b-desc {
  margin: 0;
  font-size: 12.5px;
}
.feed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 16px;
  margin-bottom: 16px;
}
.feed-game {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--brand);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.feed-game b { color: var(--brand); }
.feed-game-clear {
  cursor: pointer;
  font-size: 14px;
}
.feed-game-clear:hover { color: var(--t1); }
.b-game {
  font-size: 13px;
  font-weight: 600;
  color: var(--brand);
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
</style>

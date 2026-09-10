<template>
  <aside class="side">
    <nav class="nav">
      <router-link to="/" class="nav-item" active-class="active">
        <span class="em">🏠</span>综合首页
      </router-link>

      <!-- 1.2：选中游戏后，左侧板块只服务于该游戏的帖子流 -->
      <div v-if="gameStore.hasGame" class="game-banner" @click="goGame(gameStore.currentGame.id)">
        <el-avatar :size="22" :src="gameStore.currentGame.cover">{{ gameStore.currentGame.name?.[0] }}</el-avatar>
        <span class="gb-name">{{ gameStore.currentGame.name }}</span>
        <span class="gb-tip">查看该游戏 ›</span>
        <el-icon class="gb-clear" @click.stop="clearGame" title="取消游戏筛选（展示全部游戏）"><Close /></el-icon>
      </div>
      <div v-else class="game-hint">
        未选择游戏 · 展示全部游戏
      </div>

      <div class="nav-title">板块分类</div>
      <router-link
        v-for="b in boards"
        :key="b.id"
        :to="`/board/${b.id}`"
        class="nav-item"
        active-class="active"
      >
        <span class="em">{{ b.emoji }}</span>{{ b.name }}
        <!-- 1.2 收尾：按用户要求移除板块后"X 帖子"数字（gameStore 联动的口径与 gameId 强相关，前端数字易造成误解） -->
      </router-link>

      <div class="nav-title">我的</div>
      <router-link to="/my" class="nav-item" active-class="active">
        <span class="em">🧑</span>个人中心
      </router-link>

      <div class="nav-title">账号管理</div>
      <router-link v-if="userStore.canModerate" to="/admin" class="nav-item" active-class="active">
        <span class="em">🛡️</span>管理 / 审核
      </router-link>
      <!-- 游客：登录 / 注册；已登录：退出登录（点击后二次确认） -->
      <router-link v-if="!userStore.isLoggedIn" to="/login" class="nav-item" active-class="active">
        <span class="em">👤</span>登录 / 注册
      </router-link>
      <button v-else type="button" class="nav-item logout-item" @click="confirmLogout">
        <span class="em">🚪</span>退出登录
      </button>
    </nav>
  </aside>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close } from '@element-plus/icons-vue'
import { useUserStore, useGameStore } from '@/store'
import { FIXED_BOARDS } from '@/constants/boards'

const userStore = useUserStore()
const gameStore = useGameStore()
const router = useRouter()
// 1.2：固定六种分类（与后端 board 表 id 1-6 对齐）；帖数从 gameStore.currentBoardCounts 读取（跟随 gameStore 自动联动）
const boards = computed(() => {
  const counts = gameStore.currentBoardCounts || {}
  return FIXED_BOARDS.map((b) => ({ ...b, postCount: counts[b.id] || 0 }))
})

function clearGame() {
  gameStore.clearGame()
}
// 退出登录：先弹窗二次确认，避免误触
async function confirmLogout() {
  try {
    await ElMessageBox.confirm('退出后需要重新登录才能发帖、点赞和互动，确定要退出吗？', '退出登录', {
      confirmButtonText: '退出登录',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch (e) {
    return // 用户取消
  }
  userStore.logout()
  ElMessage.success('已退出登录')
  router.push('/')
}
// 点击游戏横幅 → 跳到该游戏详情（默认按全部板块聚合帖子）
function goGame(id) {
  if (!id) return
  router.push(`/game/${id}`)
}

onMounted(() => {
  // 兜底：若 store 还没拉过统计（如直接刷新页面 gameStore 已有但 counts 为空），这里补拉
  if (Object.keys(gameStore.allBoardCounts).length === 0 &&
      (!gameStore.currentGame || !gameStore.perGameBoardCounts[gameStore.currentGame.id])) {
    gameStore.refreshBoardStats()
  }
})
</script>

<style scoped>
.side {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 10px;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  color: var(--t2);
  font-size: 13.5px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  text-decoration: none;
}
.nav-item:hover {
  background: var(--bg-3);
  color: var(--t1);
}
.nav-item.active {
  background: var(--brand-soft);
  color: var(--brand);
  font-weight: 600;
}
.nav-item .em {
  font-size: 15px;
  width: 18px;
  text-align: center;
}
/* 退出登录用 button 实现（需要二次确认弹窗），这里抹平浏览器默认按钮样式 */
.logout-item {
  width: 100%;
  background: transparent;
  border: none;
  font-family: inherit;
  font-size: 13.5px;
  text-align: left;
}
.logout-item:hover {
  color: #f87171;
}
.nav-title {
  margin: 14px 6px 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--t3);
}
.game-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 4px 2px;
  padding: 7px 9px;
  border-radius: var(--radius-sm);
  background: var(--brand-soft);
  border: 1px solid var(--brand);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.game-banner:hover {
  background: rgba(124, 92, 255, 0.24);
  border-color: #9a82ff;
}
.game-banner .gb-name {
  font-weight: 700;
  font-size: 13px;
  color: var(--brand);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70px;
}
.game-banner .gb-tip {
  margin-left: auto;
  font-size: 10px;
  color: var(--t3);
  white-space: nowrap;
}
.game-banner .gb-clear {
  cursor: pointer;
  font-size: 13px;
  color: var(--t3);
  flex: none;
}
.game-banner .gb-clear:hover {
  color: var(--brand);
}
.game-hint {
  margin: 4px 6px 2px;
  font-size: 11px;
  color: var(--t3);
  padding: 6px 8px;
}
</style>

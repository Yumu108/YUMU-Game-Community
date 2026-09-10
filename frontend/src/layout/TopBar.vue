<template>
  <header class="topbar">
    <div class="inner">
      <!-- 移动端（≤760px）汉堡入口：打开左侧导航抽屉；桌面端 display:none 不影响原布局。
           图标用内联 SVG：Element Plus 图标库里 Menu/Grid 都是「田字格」不是三横线，
           没有现成的汉堡图标，内联 SVG 可控且随 currentColor 继承主题色。 -->
      <button class="nav-toggle" type="button" aria-label="打开导航菜单" @click="emit('toggle-nav')">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>

      <router-link to="/" class="logo">
        <span class="logo-mark">Y</span>
        <span class="logo-text">YUMU<small>游戏社区</small></span>
      </router-link>

      <div class="nav-center">
        <div class="search">
          <el-icon class="s-icon"><Search /></el-icon>
          <input
            v-model="kw"
            class="s-input"
            placeholder="搜索游戏、攻略、玩家…"
            @keyup.enter="onSearch"
          />
        </div>

        <!-- 1.2：游戏库固定上侧导航栏中部，选中即成为全局帖子流过滤维度 -->
        <el-popover
          v-model:visible="gameLibVisible"
          placement="bottom"
          :width="420"
          trigger="click"
          popper-class="gamelib-pop"
        >
          <template #reference>
            <button class="game-lib-btn" :class="{ active: gameStore.hasGame }">
              <el-icon><Grid /></el-icon>
              <span>游戏库</span>
              <el-icon class="caret"><CaretBottom /></el-icon>
            </button>
          </template>

          <div class="gamelib">
            <div class="gl-head">
              <span class="gl-title">游戏库</span>
              <span v-if="gameStore.hasGame" class="gl-cur">
                当前：<b>{{ gameStore.currentGame.name }}</b>
                <el-icon class="gl-clear" @click="clearGame"><Close /></el-icon>
              </span>
            </div>
            <el-input
              v-model="gameKw"
              size="small"
              placeholder="搜索所有游戏（含新建的）"
              :prefix-icon="Search"
              clearable
              @input="onGameSearch"
            />
            <div v-loading="gameLoading" class="gl-grid">
              <div
                v-for="g in gameList"
                :key="g.id"
                class="gl-item"
                :class="{ on: gameStore.currentGameId === g.id }"
                @click="pickGame(g)"
              >
                <el-avatar :size="34" :src="g.cover">{{ g.name?.[0] }}</el-avatar>
                <span class="gl-name">{{ g.name }}</span>
                <span class="gl-num num">{{ g.postCount || 0 }}</span>
              </div>
              <div v-if="!gameLoading && gameList.length === 0" class="gl-empty">没有匹配的游戏</div>
            </div>
            <div class="gl-foot">
              <el-button text size="small" @click="goAllGames">查看全部游戏 ›</el-button>
            </div>
          </div>
        </el-popover>
      </div>

      <div class="actions">
        <el-button type="primary" class="post-btn" @click="goEditor">
          <el-icon><EditPen /></el-icon> 发帖
        </el-button>

        <template v-if="userStore.isLoggedIn">
          <!-- 积分 + 签到 -->
          <el-button text class="points-chip" @click="goMy" title="我的积分">
            <span class="pc-ico">💎</span><span class="pc-num num">{{ points }}</span>
          </el-button>
          <el-button
            size="small"
            :type="signedToday ? 'info' : 'warning'"
            plain
            class="sign-btn"
            :loading="signing"
            @click="doSignIn"
          >
            {{ signedToday ? '已签到' : '签到 +10' }}
          </el-button>

          <el-badge :value="unread" :hidden="!unread" :max="99" class="ic-badge">
            <el-button text class="ic-btn" @click="goNotifications" title="通知">
              <el-icon><Bell /></el-icon>
            </el-button>
          </el-badge>
          <el-badge :value="unreadMsg" :hidden="!unreadMsg" :max="99" class="ic-badge">
            <el-button text class="ic-btn" @click="goMessages">
              <el-icon><ChatDotRound /></el-icon>
            </el-button>
          </el-badge>
        </template>

        <el-dropdown v-if="userStore.isLoggedIn" trigger="click">
          <span class="avatar logged">
            <el-avatar :size="34" class="ava" :src="userStore.userInfo?.avatar">{{ userInitial }}</el-avatar>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="goMine">我的主页</el-dropdown-item>
              <el-dropdown-item @click="goMyReports">我的举报</el-dropdown-item>
              <el-dropdown-item divided @click="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <router-link v-else to="/login" class="avatar">
          <el-avatar :size="34" class="ava">游</el-avatar>
        </router-link>
      </div>
    </div>
  </header>
</template>

<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Bell, ChatDotRound, Search, Grid, CaretBottom, Close } from '@element-plus/icons-vue'
import { useUserStore, useGameStore } from '@/store'
import { wsManager } from '@/utils/websocket'
import { getUnreadCount, getUnreadMessageCount, getPointsStatus, signIn, getHotGames, getGames } from '@/api/community'

const route = useRoute()
const router = useRouter()
// 移动端汉堡 → 通知父级 AppLayout 打开导航抽屉
const emit = defineEmits(['toggle-nav'])
const userStore = useUserStore()
const gameStore = useGameStore()
const kw = ref('')
// 通知未读数由 user store 共享，Notifications.vue 标记已读后可即时减数/清零
const unread = computed(() => userStore.unreadCount)
const unreadMsg = ref(0)
// 积分 / 签到状态由 user store 共享（My.vue 签到成功后会自动反映到 TopBar，无需切换页面）
const points = computed(() => userStore.points)
const signedToday = computed(() => userStore.signedToday)
const signing = ref(false)
const wsConnected = ref(false)
let wsUnsub = null

// 游戏库下拉
const gameLibVisible = ref(false)
const gameKw = ref('')
const gameLoading = ref(false)
const gameList = ref([])

const userInitial = computed(() => userStore.userInfo?.name?.[0] || '我')

async function loadHotGames() {
  // 1.2：默认展示"全部游戏最近 N 个"（含新建的非热门游戏），搜索时再覆盖为全量结果
  // 数量取 30 覆盖常规增长，避免新游戏被挤掉
  try {
    const r = await getGames({ current: 1, size: 30 })
    gameList.value = r.records || []
  } catch (e) {
    gameList.value = []
  }
}
let gameSearchTimer = null
function onGameSearch() {
  clearTimeout(gameSearchTimer)
  gameSearchTimer = setTimeout(async () => {
    gameLoading.value = true
    try {
      const data = await getGames({ keyword: gameKw.value.trim(), current: 1, size: 30 })
      gameList.value = data.records || []
    } catch (e) {
      gameList.value = []
    } finally {
      gameLoading.value = false
    }
  }, 250)
}
function pickGame(g) {
  gameStore.setGame(g)
  gameLibVisible.value = false
  router.push(`/game/${g.id}`)
}
function clearGame() {
  gameStore.clearGame()
}
function goAllGames() {
  gameLibVisible.value = false
  router.push('/games')
}

function goEditor() {
  router.push('/editor')
}
function goMine() {
  if (userStore.userInfo?.id) router.push(`/user/${userStore.userInfo.id}`)
  else ElMessage.warning('请先登录')
}
// C2 举报闭环：我的举报状态页
function goMyReports() {
  router.push('/my-reports')
}
function goNotifications() {
  router.push('/notifications')
}
function goMessages() {
  router.push('/messages')
}
async function refreshPoints() {
  if (userStore.isLoggedIn) {
    try {
      const s = await getPointsStatus()
      userStore.setSignStatus({ points: s.totalPoints || 0, signedToday: !!s.signedToday })
    } catch (e) {
      userStore.setSignStatus({ points: 0, signedToday: false })
    }
  } else {
    userStore.setSignStatus({ points: 0, signedToday: false })
  }
}
async function refreshUnread() {
  if (userStore.isLoggedIn) {
    const [n, m] = await Promise.all([
      getUnreadCount().catch(() => 0),
      getUnreadMessageCount().catch(() => 0)
    ])
    userStore.setUnreadCount(n)
    unreadMsg.value = m
    await refreshPoints()
  } else {
    unread.value = 0
    unreadMsg.value = 0
    userStore.setSignStatus({ points: 0, signedToday: false })
  }
}
async function doSignIn() {
  if (signing.value || signedToday.value) return
  signing.value = true
  try {
    const r = await signIn()
    // 立刻同步到 store：TopBar 自己、My.vue、个人中心其它组件都会立刻反映出来
    userStore.setSignStatus({ points: r.totalPoints, signedToday: !!r.signedToday })
    if (r.signed) {
      ElMessage.success(`签到成功，连续 ${r.continuousDays || 1} 天，+${r.points || 10} 积分 💎`)
    } else {
      ElMessage.info('今天已经签到过啦')
    }
  } catch (e) {
    // 拦截器已提示
  } finally {
    signing.value = false
  }
}
function logout() {
  userStore.logout()
  ElMessage.success('已退出登录')
  router.push('/')
}
function onSearch() {
  const keyword = kw.value.trim()
  if (!keyword) return
  router.push(`/search?keyword=${encodeURIComponent(keyword)}`)
}

function setupWs() {
  if (wsUnsub) return
  wsUnsub = wsManager.onMessage((msg) => {
    if (!msg) return
    // 任意通知/私信到达 → 立即重拉未读数，铃铛/私信红点实时更新
    if (msg.type === 'notification' || msg.type === 'message') {
      refreshUnread()
    }
    if (msg.type === 'notification') {
      ElNotification({ title: '新通知', message: msg.content || '你有新的通知', type: 'info', duration: 3000 })
    } else if (msg.type === 'message') {
      ElNotification({ title: '新私信', message: `${msg.fromName || '某人'}：${msg.content || ''}`, type: 'success', duration: 3000 })
    } else if (msg.type === 'connected') {
      wsConnected.value = true
    } else if (msg.type === 'status') {
      wsConnected.value = !!msg.connected
    }
  })
}

onMounted(() => {
  refreshUnread()
  loadHotGames()
  setupWs()
  if (userStore.isLoggedIn) {
    wsManager.connect(userStore.token)
  }
})
// 登录状态变化：登录即连、退出即断
watch(() => userStore.isLoggedIn, (logged) => {
  if (logged) {
    wsManager.connect(userStore.token)
  } else {
    wsManager.close()
    wsConnected.value = false
  }
})
// 同一会话内 token 刷新（如重新登录）也重连
watch(() => userStore.token, (tok) => {
  if (tok && userStore.isLoggedIn) wsManager.connect(tok)
})
// 路由变化时刷新未读（关注/被回复等产生通知后，回到其它页红点会更新）
watch(() => route.fullPath, refreshUnread)
</script>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  height: 60px;
  background: rgba(18, 20, 25, 0.85);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
}
.inner {
  max-width: 1320px;
  margin: 0 auto;
  height: 100%;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 18px;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  flex: none;
}
/* 移动端汉堡按钮：默认隐藏，≤760px 显示（见文末断点） */
.nav-toggle {
  display: none;
  flex: none;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--t1);
  cursor: pointer;
  padding: 0;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.nav-toggle:hover,
.nav-toggle:active {
  border-color: var(--brand);
  color: var(--brand);
  background: var(--brand-soft);
}
.logo-mark {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 18px;
  color: #fff;
  background: linear-gradient(135deg, var(--brand), var(--brand-2));
  box-shadow: 0 4px 14px rgba(124, 92, 255, 0.4);
}
.logo-text {
  font-weight: 800;
  font-size: 17px;
  color: var(--t1);
  letter-spacing: 0.5px;
}
.logo-text small {
  font-size: 11px;
  font-weight: 500;
  color: var(--t3);
  margin-left: 4px;
}
.nav-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-width: 0;
}
.search {
  flex: 1;
  max-width: 460px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 14px;
  height: 38px;
}
.search:focus-within {
  border-color: var(--brand);
}
.s-icon {
  color: var(--t3);
}
.s-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--t1);
  font-size: 13.5px;
  min-width: 0;
}
.s-input::placeholder {
  color: var(--t3);
}
.game-lib-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--t1);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.game-lib-btn:hover,
.game-lib-btn.active {
  border-color: var(--brand);
  color: var(--brand);
  background: var(--brand-soft);
}
.game-lib-btn .caret {
  font-size: 12px;
  color: var(--t3);
}
.actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: none;
}
.post-btn {
  background: var(--brand);
  border-color: var(--brand);
  font-weight: 600;
  border-radius: 999px;
  padding: 8px 16px;
}
.post-btn:hover {
  background: #6a4cf0;
  border-color: #6a4cf0;
}
.points-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--t2);
  font-weight: 700;
  font-size: 13px;
  padding: 0 8px;
}
.points-chip:hover {
  color: var(--brand);
}
.pc-ico {
  font-size: 15px;
}
.pc-num {
  color: #f6c453;
}
.sign-btn {
  border-radius: 999px;
  font-weight: 600;
  flex: none;
}
.avatar {
  display: block;
}
.ava {
  background: var(--brand-soft);
  color: var(--brand);
  font-weight: 700;
  border: 1px solid var(--border);
}
.ic-btn {
  position: relative;
  width: 38px;
  height: 38px;
  padding: 0;
  color: var(--t2);
  font-size: 18px;
}
.ic-btn:hover {
  color: var(--brand);
}
.ic-badge {
  margin-right: 2px;
}

/* ============================================================
   移动端适配（9-10）
   问题：顶栏原本无任何断点，390px 手机屏上「Logo + 搜索框 + 游戏库 + 发帖 +
   积分 + 签到 + 通知 + 私信 + 头像」总宽超出视口 → 头像被挤出屏幕、整页横向滚动。
   策略：窄屏逐项降级，只保留必要元素（搜索 / 发帖 / 通知 / 私信 / 头像）。
   ⚠️ 必须写在 scoped 块里：scoped 样式在组件挂载时才注入，晚于非 scoped 块；
      若写到非 scoped 块，同优先级下会被上面的 `.inner { padding: 0 20px }` 覆盖。
   ============================================================ */
@media (max-width: 760px) {
  .inner {
    padding: 0 12px;
    gap: 10px;
  }
  /* 汉堡出现 */
  .nav-toggle {
    display: grid;
  }
  /* Logo 只留图形标记 */
  .logo-text {
    display: none;
  }
  /* 搜索框可压缩（min-width:0 是关键，否则 flex 项按内容宽度撑开） */
  .search {
    flex: 1;
    min-width: 0;
    max-width: none;
    padding: 0 10px;
  }
  .s-input {
    min-width: 0;
    font-size: 13px;
  }
  /* 游戏库按钮收成图标 */
  .game-lib-btn span,
  .game-lib-btn .caret {
    display: none;
  }
  .actions {
    gap: 6px;
  }
  .post-btn {
    padding: 8px 12px;
  }
  /* 积分 / 签到：手机上收进「我的」页，顶栏不再占位 */
  .points-chip,
  .sign-btn {
    display: none;
  }
}

@media (max-width: 480px) {
  .inner {
    gap: 8px;
    padding: 0 10px;
  }
  .logo-mark {
    width: 28px;
    height: 28px;
    font-size: 16px;
  }
  /* 游戏库在窄屏隐藏（仍可从「全部游戏」页进入） */
  .game-lib-btn {
    display: none;
  }
  .post-btn {
    padding: 7px 10px;
    font-size: 13px;
  }
  .ic-badge {
    margin-right: 0;
  }
  /* 手机屏（≤480px）顶栏不再挤搜索框（3 项图标 + 头像 + 汉堡后只剩几十像素，
     输入框宽度不可用）→ 隐藏，改由导航抽屉顶部的全宽搜索入口承接，见 AppLayout。
     隐藏后 .nav-center 变空但保留 flex:1，正好把 .actions 顶到右侧。 */
  .search {
    display: none;
  }
  .nav-toggle {
    width: 34px;
    height: 34px;
  }
}
</style>

<style>
/* 游戏库下拉面板（非 scoped，作用于 popper；强制深色主题，脱离 EP 默认浅色） */
.gamelib-pop {
  padding: 0 !important;
  background: var(--bg-2) !important;
  border: 1px solid var(--border) !important;
  border-radius: 12px !important;
  box-shadow: var(--shadow) !important;
  color: var(--t1);
  overflow: hidden;
}
.gamelib-pop .gamelib {
  padding: 12px;
}
.gamelib .gl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.gamelib .gl-title {
  font-weight: 800;
  font-size: 15px;
  color: var(--t1);
}
.gamelib .gl-cur {
  font-size: 12px;
  color: var(--t2);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.gamelib .gl-cur b {
  color: var(--brand);
  font-weight: 700;
}
.gamelib .gl-clear {
  cursor: pointer;
  font-size: 13px;
  color: var(--t2);
}
.gamelib .gl-clear:hover {
  color: var(--brand);
}
/* 搜索输入框：深色背景 + 浅色文字（EP 浅色默认会被覆盖） */
.gamelib .el-input__wrapper {
  background-color: var(--bg-1) !important;
  box-shadow: inset 0 0 0 1px var(--border) !important;
}
.gamelib .el-input__wrapper:hover,
.gamelib .el-input__wrapper.is-focus {
  box-shadow: inset 0 0 0 1px var(--brand) !important;
}
.gamelib .el-input__inner {
  color: var(--t1) !important;
}
.gamelib .el-input__inner::placeholder {
  color: var(--t3);
}
.gamelib .gl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
  max-height: 320px;
  overflow: auto;
  padding: 2px;
}
.gamelib .gl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  background: var(--bg-1);
  transition: background 0.15s, border-color 0.15s;
}
.gamelib .gl-item:hover {
  background: var(--bg-3);
  border-color: var(--border);
}
.gamelib .gl-item.on {
  border-color: var(--brand);
  background: var(--brand-soft);
}
.gamelib .gl-name {
  flex: 1;
  font-size: 13px;
  color: var(--t1);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gamelib .gl-num {
  font-size: 11.5px;
  color: var(--brand);
  font-weight: 700;
  background: var(--brand-soft);
  padding: 1px 8px;
  border-radius: 999px;
  flex: none;
}
.gamelib .gl-empty {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--t3);
  font-size: 13px;
  padding: 20px 0;
}
.gamelib .gl-foot {
  margin-top: 8px;
  text-align: right;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.gamelib .gl-foot .el-button {
  color: var(--brand);
}

</style>

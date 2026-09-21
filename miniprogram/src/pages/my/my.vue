<template>
  <view class="mp-page">
    <!--
      账号区：账号与主站通用（2026-09-17 接入登录）。
      🚨 2026-09-21 口径变更：游客（未登录）**只能看浏览记录** ——
        收藏 / 点赞 / 举报都需要登录。所以这里的副标题要**如实说明差在哪**，
        而不是像旧版那样写「收藏、点赞与浏览记录都保存在本机」（那已经是错的：
        收藏/点赞既不本机、也不对游客开放）。
    -->
    <view class="user">
      <view class="user__avatar">{{ avatarLetter }}</view>
      <view class="user__info">
        <text class="user__name">{{ logged ? user.nickname || user.username : '访客模式' }}</text>
        <text class="user__tip">
          {{ logged ? '已登录（账号与主站通用）' : '游客只能查看浏览记录；收藏 / 点赞 / 举报需先登录' }}
        </text>
      </view>
      <text v-if="!logged" class="user__login" @click="goLogin">登录 / 注册</text>
      <text v-else class="user__login user__login--out" @click="onLogout">退出</text>
    </view>

    <!-- Tab：游客只有一个（历史），登录后才有收藏 / 点赞 -->
    <view class="tabs">
      <view
        v-for="t in tabs"
        :key="t.key"
        class="tabs__item"
        :class="{ 'tabs__item--on': tab === t.key }"
        @click="tab = t.key"
      >
        {{ t.label }}
      </view>
    </view>

    <!--
      同步提示：收藏 / 点赞来自端内索引（服务端数据）。
      `stale` = 本次同步失败但用上了上一次的内容 —— 必须说出来，
      否则用户会把「看到的旧列表」当成当前事实（本项目反复踩的那类坑）。
    -->
    <view v-if="stale && tab !== 'his'" class="hint">
      <text class="hint__text">⚠️ 网络异常，以下为上一次同步的内容，可能不是最新</text>
    </view>

    <!-- 内容：本地历史与本服务端列表共用一套渲染 -->
    <Skeleton v-if="loading" :rows="3" />

    <ErrorState
      v-else-if="failed"
      icon="📡"
      text="列表加载失败"
      :sub="errMsg"
      @retry="loadServerLists"
    />

    <template v-else-if="current.length">
      <view v-for="it in current" :key="it.id" class="item" @click="goItem(it)">
        <view class="item__body">
          <text class="item__title mp-ellipsis">{{ it.title }}</text>
          <view class="item__meta">
            <text v-if="it.gameName" class="mp-tag mp-tag--purple">{{ it.gameName }}</text>
            <text v-if="it.boardName" class="item__board">{{ it.boardName }}</text>
            <text class="item__time">{{ timeOf(it.at || it.createdAt) }}</text>
          </view>
        </view>
        <text class="item__arrow">›</text>
      </view>

      <!-- 清空只对「浏览记录」有意义：收藏/点赞在服务端，逐条取消才是正确做法 -->
      <view v-if="tab === 'his'" class="danger" @click="onClear">清空浏览记录</view>
    </template>

    <EmptyState v-else :icon="emptyIcon" :text="emptyText" :sub="emptySub" />

    <!-- 说明 -->
    <view class="about">
      <text class="about__title">关于</text>
      <text class="about__text">
        YUMU 攻略库 · 内容来自 YUMU 游戏社区。本端做多平台攻略与资讯的聚合和分类展示，
        不含发帖、回复、私信等社交功能。
      </text>
      <text class="about__text about__text--mt">
        {{ logged
          ? '收藏与点赞保存在账号里（服务端），换设备登录同一账号即可看到；浏览历史保存在本机。'
          : '浏览历史保存在本机（换设备不会同步）；收藏、点赞、举报需要登录后才能使用。' }}
      </text>
    </view>
  </view>
</template>

<script setup>
/**
 * 「我的」= 收藏 / 点赞（**服务端**，需登录）+ 浏览历史（**本机**，游客也可用）。
 *
 * 🚨 2026-09-21 口径变更（重要）：
 *   · 游客（未登录）**只展示「浏览记录」**这一个 Tab —— 收藏与点赞都需要登录，
 *     对一个没登录的人展示空列表毫无意义，还会让人以为是数据丢了；
 *   · 登录后收藏 / 点赞的**数据源是服务端**：端内索引的记录带 `liked` / `favorited`
 *     （后端在带 token 的列表请求里下发），这里只是筛一遍 —— **0 额外请求**。
 *   · 所以本页依赖索引缓存，**登录 / 退出时必须让缓存失效**
 *     （`clearIndexCache()`，登录页与下面的退出流程各调一次），否则会显示上一个身份的数据。
 *
 * 定位仍是「弱化互动的展示端」：这里没有任何社交入口（关注、粉丝、私信一律没有）。
 */
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getHistory, clearHistory, getUser, clearUser } from '../../utils/store'
import { logout } from '../../api/auth'
import { clearSession } from '../../api/request'
import { ensureIndex, clearIndexCache } from '../../utils/guideIndex'
import { formatTime } from '../../utils/format'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

const tab = ref('his')
const favorites = ref([])
const likes = ref([])
const history = ref([])
const user = ref(null)
const logged = ref(false)

/** 收藏 / 点赞来自索引 ⇒ 有加载态与失败态；历史是本机数据，不会失败 */
const loading = ref(false)
const failed = ref(false)
const errMsg = ref('')
const stale = ref(false)

const avatarLetter = computed(() => {
  const u = user.value
  if (!u) return '游'
  return (u.nickname || u.username || '游').slice(0, 1)
})

/**
 * Tab 列表按登录态生成 —— 游客**只给历史**。
 * 这样游客既看不到空列表，也不需要「点了再告诉你先登录」这种绕路。
 */
const tabs = computed(() =>
  logged.value
    ? [
        { key: 'fav', label: `收藏 ${favorites.value.length}` },
        { key: 'like', label: `点赞 ${likes.value.length}` },
        { key: 'his', label: `历史 ${history.value.length}` }
      ]
    : [{ key: 'his', label: `历史 ${history.value.length}` }]
)

const current = computed(() =>
  tab.value === 'fav' ? favorites.value : tab.value === 'like' ? likes.value : history.value
)
const emptyIcon = computed(() => (tab.value === 'fav' ? '★' : tab.value === 'like' ? '👍' : '🕘'))
const emptyText = computed(() =>
  tab.value === 'fav'
    ? '还没有收藏内容'
    : tab.value === 'like'
      ? '还没有点赞内容'
      : logged.value
        ? '还没有浏览记录'
        : '登录后才有收藏与点赞'
)
const emptySub = computed(() =>
  tab.value === 'his' ? '去攻略库逛逛，看过的帖子会自动记在这里' : '在帖子详情页底部可以收藏 / 点赞'
)

const timeOf = (v) => formatTime(v)

/** 取服务端列表（= 端内索引里带 liked / favorited 的记录） */
async function loadServerLists() {
  if (!logged.value) {
    favorites.value = []
    likes.value = []
    loading.value = false
    failed.value = false
    stale.value = false
    return
  }
  loading.value = true
  failed.value = false
  try {
    const res = await ensureIndex({})
    const items = res.items || []
    favorites.value = items.filter((it) => it.favorited === true)
    likes.value = items.filter((it) => it.liked === true)
    stale.value = res.stale === true
  } catch (e) {
    failed.value = true
    errMsg.value = (e && e.message) || '请稍后重试'
    favorites.value = []
    likes.value = []
  } finally {
    loading.value = false
  }
}

/** onShow：从详情页返回后要能看到刚收藏 / 刚点赞 / 刚浏览的内容；登录态也在这里刷新 */
onShow(() => {
  user.value = getUser()
  logged.value = !!user.value
  // 退出登录后若停在收藏/点赞 Tab 上，会看到「游客却在看收藏」的错位
  if (!logged.value && tab.value !== 'his') tab.value = 'his'
  history.value = getHistory()
  loadServerLists()
})

function goLogin() {
  uni.navigateTo({ url: '/pages/login/login' })
}

/**
 * 退出登录：先尽力通知后端把 token 入黑名单，**无论成败都清本地会话**。
 * （后端 /auth/logout 对已过期 token 也是 no-op，语义上就是「清残留」。）
 *
 * 🚨 必须同时 `clearIndexCache()`：索引里存着这个账号的 `liked` / `favorited`，
 *   不清的话退登后「我的」页仍会显示**上一个账号的**收藏与点赞。
 *   本地浏览历史**保留** —— 它不绑账号，是这台设备的记录。
 */
function onLogout() {
  uni.showModal({
    title: '退出登录',
    content: '收藏与点赞保存在账号里，退出后本机不再展示；浏览记录会保留在本机。',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await logout()
      } catch (e) {
        /* 后端失败不阻断 —— 本地必须清干净 */
      }
      clearSession()
      clearUser()
      clearIndexCache()
      user.value = null
      logged.value = false
      tab.value = 'his'
      favorites.value = []
      likes.value = []
      uni.showToast({ title: '已退出登录', icon: 'none' })
    }
  })
}

function goItem(it) {
  uni.navigateTo({ url: `/pages/post/detail?id=${it.id}` })
}

function onClear() {
  uni.showModal({
    title: '确认清空',
    content: '将删除全部本机浏览记录，确定吗？',
    success: (res) => {
      if (!res.confirm) return
      clearHistory()
      history.value = getHistory()
      uni.showToast({ title: '已清空', icon: 'none' })
    }
  })
}
</script>

<style scoped>
.user {
  display: flex;
  align-items: center;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 24rpx;
  padding: 28rpx;
}
.user__avatar {
  width: 92rpx;
  height: 92rpx;
  border-radius: 50%;
  background: #3a3350;
  color: #cbbdff;
  font-size: 34rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.user__login {
  margin-left: auto;
  flex-shrink: 0;
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  background: #7c5cff;
  color: #fff;
  font-size: 24rpx;
  font-weight: 600;
}
.user__login--out {
  background: transparent;
  border: 1rpx solid #3a3350;
  color: #a49eb6;
  font-weight: 400;
}
.user__info {
  flex: 1;
  min-width: 0;
  margin-left: 22rpx;
}
.user__name {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: #e9e7f2;
}
.user__tip {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #8b8599;
}

/* 同步提示（stale）—— 与普通说明区分开，别让它淹没在灰字里 */
.hint {
  padding: 14rpx 18rpx;
  margin-bottom: 16rpx;
  background: rgba(255, 176, 32, 0.1);
  border: 1rpx solid rgba(255, 176, 32, 0.32);
  border-radius: 14rpx;
}
.hint__text {
  font-size: 21rpx;
  color: #ffce7a;
  line-height: 1.6;
}

.tabs {
  display: flex;
  margin: 26rpx 0 22rpx;
  background: #231f31;
  border-radius: 16rpx;
  padding: 6rpx;
}
.tabs__item {
  flex: 1;
  text-align: center;
  font-size: 25rpx;
  color: #a49eb6;
  padding: 14rpx 0;
  border-radius: 12rpx;
}
.tabs__item--on {
  background: rgba(124, 92, 255, 0.22);
  color: #cbbdff;
  font-weight: 600;
}

.item {
  display: flex;
  align-items: center;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 20rpx;
  padding: 22rpx;
  margin-bottom: 14rpx;
}
.item__body {
  flex: 1;
  min-width: 0;
}
.item__title {
  display: block;
  font-size: 28rpx;
  color: #e9e7f2;
}
.item__meta {
  display: flex;
  align-items: center;
  margin-top: 10rpx;
}
/* uni-text 自带 white-space: pre-line，不逐个命中会被长游戏名拆行 */
.item__meta > * {
  white-space: nowrap;
}
.item__board {
  font-size: 22rpx;
  color: #8b8599;
  margin-left: 12rpx;
}
.item__time {
  font-size: 22rpx;
  color: #8b8599;
  margin-left: auto;
}
.item__arrow {
  font-size: 30rpx;
  color: #8b8599;
  margin-left: 14rpx;
}

.danger {
  text-align: center;
  font-size: 25rpx;
  color: #f0b45f;
  padding: 24rpx 0;
}

.about {
  margin-top: 40rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background: #1a1725;
  border: 1rpx solid #2a2538;
}
.about__title {
  display: block;
  font-size: 25rpx;
  color: #a49eb6;
  margin-bottom: 10rpx;
}
.about__text {
  font-size: 23rpx;
  color: #8b8599;
  line-height: 1.7;
}
.about__text--mt {
  display: block;
  margin-top: 12rpx;
}
</style>

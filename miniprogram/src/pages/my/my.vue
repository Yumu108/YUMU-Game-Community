<template>
  <view class="mp-page">
    <!--
      账号区：2026-09-17 接入登录（与主站账号通用）。
      未登录仍叫「访客模式」（不写「未登录」，那看起来像功能坏了）；
      收藏、点赞、历史仍为本机记录 —— 登录当前只服务于「举报」等需要身份的动作。
    -->
    <view class="user">
      <view class="user__avatar">{{ user ? (user.nickname || user.username || '游').slice(0, 1) : '游' }}</view>
      <view class="user__info">
        <text class="user__name">{{ user ? user.nickname || user.username : '访客模式' }}</text>
        <text class="user__tip">{{ user ? '已登录（账号与主站通用）' : '收藏、点赞与浏览记录都保存在本机' }}</text>
      </view>
      <text v-if="!user" class="user__login" @click="goLogin">登录 / 注册</text>
      <text v-else class="user__login user__login--out" @click="onLogout">退出</text>
    </view>

    <!-- 切换 -->
    <view class="tabs">
      <view class="tabs__item" :class="{ 'tabs__item--on': tab === 'fav' }" @click="tab = 'fav'">
        收藏 {{ favorites.length }}
      </view>
      <view class="tabs__item" :class="{ 'tabs__item--on': tab === 'like' }" @click="tab = 'like'">
        点赞 {{ likes.length }}
      </view>
      <view class="tabs__item" :class="{ 'tabs__item--on': tab === 'his' }" @click="tab = 'his'">
        历史 {{ history.length }}
      </view>
    </view>

    <!-- 列表 -->
    <template v-if="current.length">
      <view v-for="it in current" :key="it.id" class="item" @click="goItem(it)">
        <view class="item__body">
          <text class="item__title mp-ellipsis">{{ it.title }}</text>
          <view class="item__meta">
            <text v-if="it.gameName" class="mp-tag mp-tag--purple">{{ it.gameName }}</text>
            <text v-if="it.boardName" class="item__board">{{ it.boardName }}</text>
            <text class="item__time">{{ timeOf(it.at) }}</text>
          </view>
        </view>
        <text class="item__arrow">›</text>
      </view>

      <view class="danger" @click="onClear">{{ clearLabel }}</view>
    </template>

    <EmptyState
      v-else
      :icon="emptyIcon"
      :text="emptyText"
      sub="去攻略库逛逛，看到有用的点个收藏"
    />

    <!-- 说明 -->
    <view class="about">
      <text class="about__title">关于</text>
      <text class="about__text">
        YUMU 攻略库 · 内容来自 YUMU 游戏社区。本端做多平台攻略与资讯的聚合和分类展示，
        不含发帖、回复、私信等社交功能；点赞与收藏是**本机记录**（换设备不会同步）。
      </text>
    </view>
  </view>
</template>

<script setup>
/**
 * 「我的」= 本机收藏 / 点赞 / 浏览历史。
 *
 * 定位调整后这里**不再有任何社交入口**（关注、粉丝、私信一律没有），
 * 只保留读者自己攒下来的内容清单 —— 与「弱化互动、强化内容」的口径一致。
 */
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import {
  getFavorites,
  getLikes,
  getHistory,
  clearHistory,
  clearLikes,
  toggleFavorite,
  getUser,
  clearUser
} from '../../utils/store'
import { logout } from '../../api/auth'
import { clearSession } from '../../api/request'
import { formatTime } from '../../utils/format'
import EmptyState from '../../components/EmptyState.vue'

const tab = ref('fav')
const favorites = ref([])
const likes = ref([])
const history = ref([])
const user = ref(null)

const current = computed(() =>
  tab.value === 'fav' ? favorites.value : tab.value === 'like' ? likes.value : history.value
)
const clearLabel = computed(() =>
  tab.value === 'fav' ? '清空收藏' : tab.value === 'like' ? '清空点赞' : '清空历史'
)
const emptyIcon = computed(() => (tab.value === 'fav' ? '★' : tab.value === 'like' ? '👍' : '🕘'))
const emptyText = computed(
  () =>
    tab.value === 'fav' ? '还没有收藏内容' : tab.value === 'like' ? '还没有点赞内容' : '还没有浏览记录'
)

const timeOf = (v) => formatTime(v)

/** onShow：从详情页返回后要能看到刚收藏 / 刚点赞 / 刚浏览的内容；登录态也在这里刷新 */
onShow(() => {
  favorites.value = getFavorites()
  likes.value = getLikes()
  history.value = getHistory()
  user.value = getUser()
})

function goLogin() {
  uni.navigateTo({ url: '/pages/login/login' })
}

/**
 * 退出登录：先尽力通知后端把 token 入黑名单，**无论成败都清本地会话**。
 * （后端 /auth/logout 对已过期 token 也是 no-op，语义上就是「清残留」。）
 */
function onLogout() {
  uni.showModal({
    title: '退出登录',
    content: '本机的收藏、点赞与浏览记录会保留，确定退出吗？',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await logout()
      } catch (e) {
        /* 后端失败不阻断 —— 本地必须清干净 */
      }
      clearSession()
      clearUser()
      user.value = null
      uni.showToast({ title: '已退出登录', icon: 'none' })
    }
  })
}

function goItem(it) {
  uni.navigateTo({ url: `/pages/post/detail?id=${it.id}` })
}

function onClear() {
  const t = tab.value
  const name = t === 'fav' ? '收藏' : t === 'like' ? '点赞' : '浏览历史'
  uni.showModal({
    title: '确认清空',
    content: `将删除全部本机${name}记录，确定吗？`,
    success: (res) => {
      if (!res.confirm) return
      if (t === 'fav') {
        // 逐条取消收藏，复用同一套存储写入逻辑
        favorites.value.forEach((f) => toggleFavorite(f))
      } else if (t === 'like') {
        clearLikes()
      } else {
        clearHistory()
      }
      favorites.value = getFavorites()
      likes.value = getLikes()
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
</style>

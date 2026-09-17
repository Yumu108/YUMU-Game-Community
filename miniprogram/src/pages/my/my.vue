<template>
  <view class="mp-page">
    <!--
      账号区：本端定位是**内容浏览端**，不做登录（社交动作在 Web 端完成）。
      🚨 文案注意：不要写「未登录」——那看起来像登录功能坏了；
        写成「访客模式」才是如实描述设计选择。
    -->
    <view class="user">
      <view class="user__avatar">游</view>
      <view class="user__info">
        <text class="user__name">访客模式</text>
        <text class="user__tip">收藏与浏览记录保存在本机</text>
      </view>
    </view>

    <!-- 切换 -->
    <view class="tabs">
      <view class="tabs__item" :class="{ 'tabs__item--on': tab === 'fav' }" @click="tab = 'fav'">
        我的收藏 {{ favorites.length }}
      </view>
      <view class="tabs__item" :class="{ 'tabs__item--on': tab === 'his' }" @click="tab = 'his'">
        浏览历史 {{ history.length }}
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

      <view class="danger" @click="onClear">{{ tab === 'fav' ? '清空收藏' : '清空历史' }}</view>
    </template>

    <EmptyState
      v-else
      :icon="tab === 'fav' ? '★' : '🕘'"
      :text="tab === 'fav' ? '还没有收藏内容' : '还没有浏览记录'"
      sub="去首页或游戏库逛逛吧"
    />

    <!-- 说明 -->
    <view class="about">
      <text class="about__title">关于</text>
      <text class="about__text">
        YUMU 游戏助手 · 内容来自 YUMU 游戏社区。本端只做内容浏览，不含发帖、私信等社交功能。
      </text>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getFavorites, getHistory, clearHistory, toggleFavorite } from '../../utils/store'
import { formatTime } from '../../utils/format'
import EmptyState from '../../components/EmptyState.vue'

const tab = ref('fav')
const favorites = ref([])
const history = ref([])

const current = computed(() => (tab.value === 'fav' ? favorites.value : history.value))
const timeOf = (v) => formatTime(v)

/** onShow：从详情页返回后要能看到刚收藏/刚浏览的内容 */
onShow(() => {
  favorites.value = getFavorites()
  history.value = getHistory()
})

function goItem(it) {
  uni.navigateTo({ url: `/pages/post/detail?id=${it.id}` })
}

function onClear() {
  const isFav = tab.value === 'fav'
  uni.showModal({
    title: '确认清空',
    content: isFav ? '将删除全部本地收藏，确定吗？' : '将删除全部本地浏览历史，确定吗？',
    success: (res) => {
      if (!res.confirm) return
      if (isFav) {
        // 逐条取消收藏，复用同一套存储写入逻辑
        favorites.value.forEach((f) => toggleFavorite(f))
      } else {
        clearHistory()
      }
      favorites.value = getFavorites()
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
  color: #6f6a80;
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
  color: #8b8599;
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
.item__board {
  font-size: 22rpx;
  color: #6f6a80;
  margin-left: 12rpx;
}
.item__time {
  font-size: 22rpx;
  color: #6f6a80;
  margin-left: auto;
}
.item__arrow {
  font-size: 30rpx;
  color: #6f6a80;
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
  color: #8b8599;
  margin-bottom: 10rpx;
}
.about__text {
  font-size: 23rpx;
  color: #6f6a80;
  line-height: 1.7;
}
</style>

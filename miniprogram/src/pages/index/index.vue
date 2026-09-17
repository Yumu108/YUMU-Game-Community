<template>
  <view class="mp-page">
    <!-- 搜索入口 -->
    <view class="search" @click="goSearch">
      <text class="search__icon">🔍</text>
      <text class="search__ph">搜索游戏 / 攻略 / 资讯</text>
    </view>

    <!-- 品牌横幅 -->
    <view class="banner">
      <text class="banner__title">YUMU 游戏助手</text>
      <text class="banner__desc">找游戏 · 看攻略 · 追更新</text>
      <view class="banner__btns">
        <view class="btn" @click="goGames">逛游戏库</view>
        <view class="btn btn--ghost" @click="goNews">看资讯</view>
      </view>
    </view>

    <!-- 统计条 -->
    <view class="stats">
      <view class="stats__item">
        <text class="stats__num">{{ hotGames.length }}</text>
        <text class="stats__label">热门游戏</text>
      </view>
      <view class="stats__divider" />
      <view class="stats__item">
        <text class="stats__num">{{ guideTotal }}</text>
        <text class="stats__label">攻略篇数</text>
      </view>
      <view class="stats__divider" />
      <view class="stats__item">
        <text class="stats__num">{{ newsTotal }}</text>
        <text class="stats__label">资讯动态</text>
      </view>
    </view>

    <!-- 热门游戏 -->
    <view class="mp-sec">
      <text class="mp-sec__title">🔥 热门游戏</text>
      <text class="mp-sec__more" @click="goGames">全部 ›</text>
    </view>
    <Skeleton v-if="loading" :rows="1" />
    <scroll-view v-else scroll-x class="hscroll">
      <view class="hscroll__inner">
        <view v-for="g in hotGames" :key="g.id" class="gcard" @click="goGame(g)">
          <GameTile :game="g" size="lg" />
          <text class="gcard__name mp-ellipsis">{{ g.name }}</text>
          <text class="gcard__meta">
            <text class="mp-num">{{ g.postCount || 0 }}</text> 帖
          </text>
        </view>
      </view>
    </scroll-view>
    <EmptyState v-if="!loading && !hotGames.length" icon="🎮" text="暂无热门游戏" />

    <!-- 最新资讯 -->
    <view class="mp-sec">
      <text class="mp-sec__title">📰 最新资讯</text>
      <text class="mp-sec__more" @click="goNews">更多 ›</text>
    </view>
    <Skeleton v-if="loading" :rows="2" />
    <template v-else>
      <PostCard v-for="p in news" :key="p.id" :post="p" />
      <EmptyState v-if="!news.length" icon="📰" text="暂无资讯" sub="去看看攻略吧" />
    </template>

    <!-- 推荐攻略 -->
    <view class="mp-sec">
      <text class="mp-sec__title">🧭 推荐攻略</text>
      <text class="mp-sec__more" @click="goGuideBoard">更多 ›</text>
    </view>
    <Skeleton v-if="loading" :rows="2" />
    <template v-else>
      <PostCard v-for="p in guides" :key="p.id" :post="p" />
      <EmptyState v-if="!guides.length" icon="🧭" text="暂无攻略" />
    </template>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import { fetchHotGames, homeSources } from '../../api/community'
import GameTile from '../../components/GameTile.vue'
import PostCard from '../../components/PostCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'

const loading = ref(true)
const hotGames = ref([])
const news = ref([])
const guides = ref([])
const newsTotal = ref(0)
const guideTotal = ref(0)

async function load() {
  loading.value = true
  // 三个请求并发；用 allSettled —— 任一模块失败不应拖垮整页
  const [g, n, d] = await Promise.allSettled([
    fetchHotGames(8),
    homeSources.news(5),
    homeSources.guides(5)
  ])

  // `/games/hot` 的 data 是纯数组，不是分页体，这里要区分对待
  if (g.status === 'fulfilled') hotGames.value = g.value || []
  if (n.status === 'fulfilled') {
    news.value = (n.value && n.value.records) || []
    newsTotal.value = (n.value && n.value.total) || 0
  }
  if (d.status === 'fulfilled') {
    guides.value = (d.value && d.value.records) || []
    guideTotal.value = (d.value && d.value.total) || 0
  }
  loading.value = false
}

onLoad(load)
onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
})

function goSearch() {
  uni.navigateTo({ url: '/pages/search/search' })
}
function goGames() {
  uni.switchTab({ url: '/pages/games/games' })
}
function goNews() {
  uni.switchTab({ url: '/pages/news/news' })
}
function goGame(g) {
  uni.navigateTo({ url: `/pages/game/detail?id=${g.id}&name=${encodeURIComponent(g.name || '')}` })
}
function goGuideBoard() {
  uni.navigateTo({ url: '/pages/list/list?boardId=1&sort=hot&title=' + encodeURIComponent('攻略心得') })
}
</script>

<style scoped>
/* 搜索入口 */
.search {
  height: 72rpx;
  border-radius: 36rpx;
  background: #231f31;
  display: flex;
  align-items: center;
  padding: 0 26rpx;
}
.search__icon {
  font-size: 26rpx;
  margin-right: 12rpx;
}
.search__ph {
  font-size: 25rpx;
  color: #6f6a80;
}

/* 品牌横幅 */
.banner {
  margin-top: 20rpx;
  border-radius: 28rpx;
  padding: 32rpx 28rpx;
  background: #221d33;
  border: 1rpx solid #332c4a;
}
.banner__title {
  display: block;
  font-size: 36rpx;
  font-weight: 700;
  color: #e9e7f2;
}
.banner__desc {
  display: block;
  margin-top: 8rpx;
  font-size: 25rpx;
  color: #8b8599;
}
.banner__btns {
  display: flex;
  margin-top: 24rpx;
}
.btn {
  font-size: 25rpx;
  padding: 12rpx 32rpx;
  border-radius: 30rpx;
  background: #7c5cff;
  color: #fff;
  font-weight: 500;
}
.btn--ghost {
  background: transparent;
  border: 1rpx solid #4a4166;
  color: #b9b3c9;
  margin-left: 18rpx;
}

/* 统计条 */
.stats {
  display: flex;
  align-items: center;
  margin-top: 22rpx;
  border-radius: 22rpx;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  padding: 24rpx 0;
}
.stats__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.stats__num {
  font-size: 34rpx;
  font-weight: 700;
  color: #b9a9ff;
}
.stats__label {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #6f6a80;
}
.stats__divider {
  width: 1rpx;
  height: 44rpx;
  background: #2a2538;
}

/* 热门游戏横滑 */
.hscroll {
  white-space: nowrap;
  width: 100%;
}
.hscroll__inner {
  display: inline-flex;
  padding-bottom: 6rpx;
}
.gcard {
  width: 210rpx;
  flex: none;
  margin-right: 18rpx;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 22rpx;
  padding: 20rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.gcard__name {
  margin-top: 14rpx;
  font-size: 25rpx;
  color: #e9e7f2;
  max-width: 170rpx;
}
.gcard__meta {
  margin-top: 6rpx;
  font-size: 21rpx;
  color: #6f6a80;
}
</style>

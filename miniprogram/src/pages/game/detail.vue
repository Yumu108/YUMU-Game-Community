<template>
  <view class="mp-page">
    <!-- 游戏头 -->
    <view class="hero">
      <GameTile :game="game || { name }" size="lg" />
      <view class="hero__body">
        <text class="hero__name">{{ (game && game.name) || name }}</text>
        <text class="hero__desc mp-clamp-2">
          {{ (game && (game.description || game.developer)) || '加载中…' }}
        </text>
        <view class="hero__tags">
          <text v-if="game && game.platform" class="mp-tag mp-tag--purple">{{ game.platform }}</text>
          <text v-if="game && game.genre" class="mp-tag">{{ game.genre }}</text>
          <text v-if="game && game.releaseDate" class="mp-tag mp-tag--orange">
            {{ String(game.releaseDate).slice(0, 10) }}
          </text>
        </view>
      </view>
    </view>

    <!-- 双 Tab：攻略 / 资讯 -->
    <view class="tabs">
      <view class="tabs__item" :class="{ 'tabs__item--on': tab === 'guide' }" @click="switchTab('guide')">
        攻略
      </view>
      <view class="tabs__item" :class="{ 'tabs__item--on': tab === 'news' }" @click="switchTab('news')">
        资讯
      </view>
    </view>

    <Skeleton v-if="loading" :rows="3" />
    <template v-else>
      <PostCard v-for="p in list" :key="p.id" :post="p" />
      <ErrorState
        v-if="failed"
        icon="📡"
        text="帖子加载失败"
        sub="检查网络后重试，或下拉刷新"
        @retry="reload"
      />
      <EmptyState
        v-else-if="!list.length"
        :icon="tab === 'guide' ? '🧭' : '📰'"
        :text="tab === 'guide' ? '这款游戏还没有攻略' : '这款游戏还没有资讯'"
      />
      <view v-if="list.length" class="footer" @click="retryMore">{{ footerText }}</view>
    </template>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { fetchGameDetail, fetchGamePosts } from '../../api/community'
import { BOARD, SORT } from '../../api/config'
import { usePagedList } from '../../utils/usePagedList'
import GameTile from '../../components/GameTile.vue'
import PostCard from '../../components/PostCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

const gameId = ref(0)
const name = ref('')
const game = ref(null)
const tab = ref('guide')

const boardIdOfTab = () => (tab.value === 'guide' ? BOARD.GUIDE : BOARD.NEWS)

const { list, loading, failed, footerText, reload, loadMore, retryMore } = usePagedList(
  ({ current, size }) =>
    fetchGamePosts(gameId.value, { boardId: boardIdOfTab(), sort: SORT.LATEST, current, size })
)

function switchTab(t) {
  if (tab.value === t) return
  tab.value = t
  reload()
}

onLoad(async (q = {}) => {
  gameId.value = Number(q.id) || 0
  name.value = q.name ? decodeURIComponent(q.name) : ''
  if (name.value) uni.setNavigationBarTitle({ title: name.value })

  if (gameId.value) {
    try {
      game.value = await fetchGameDetail(gameId.value)
      if (game.value && game.value.name) {
        name.value = game.value.name
        uni.setNavigationBarTitle({ title: game.value.name })
      }
    } catch (e) {
      /* 详情失败仍可看帖子 */
    }
  }
  await reload()
})

onReachBottom(loadMore)

onPullDownRefresh(async () => {
  await reload()
  uni.stopPullDownRefresh()
})
</script>

<style scoped>
.hero {
  display: flex;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 24rpx;
  padding: 26rpx;
}
.hero__body {
  flex: 1;
  min-width: 0;
  margin-left: 22rpx;
}
.hero__name {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  color: #e9e7f2;
}
.hero__desc {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: #8b8599;
  line-height: 1.6;
}
.hero__tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: 14rpx;
}
.hero__tags .mp-tag {
  margin: 0 12rpx 8rpx 0;
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
  font-size: 27rpx;
  color: #8b8599;
  padding: 14rpx 0;
  border-radius: 12rpx;
}
.tabs__item--on {
  background: rgba(124, 92, 255, 0.22);
  color: #cbbdff;
  font-weight: 600;
}

.footer {
  text-align: center;
  font-size: 23rpx;
  color: #6f6a80;
  padding: 24rpx 0 10rpx;
}
</style>

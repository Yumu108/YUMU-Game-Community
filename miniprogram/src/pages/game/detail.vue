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
          <text v-if="game && game.platform" class="mp-tag mp-tag--purple">{{ platName(game.platform) }}</text>
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
      <PostCard v-for="p in shownList" :key="p.id" :post="p" />
      <ErrorState
        v-if="failed"
        icon="📡"
        text="内容加载失败"
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
/**
 * 游戏详情 —— 「按游戏聚合」这一维度的落点。
 *
 * 首页是「按文章的平台聚合」，这里是「按游戏聚合」：同一款游戏下的攻略与资讯。
 * `/games/{id}/posts` 是后端原生接口（支持 boardId / sort / 分页），跑真·服务端分页。
 *
 * ⚠️ 列表接口**不下发 platform**（platform 只存在于 game 表），
 *   所以这里用本页已经拿到的 `game.platform` 回填给每条帖子 ——
 *   这样 PostCard 的平台角标在这一页也能正常显示，与其他页视觉一致。
 */
import { ref, computed } from 'vue'
import { onLoad, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { fetchGameDetail, fetchGamePosts } from '../../api/community'
import { BOARD, SORT } from '../../api/config'
import { platformLabel } from '../../utils/format'
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

const platName = (v) => platformLabel(v)

const boardIdOfTab = () => (tab.value === 'guide' ? BOARD.GUIDE : BOARD.NEWS)

const { list, loading, failed, footerText, reload, loadMore, retryMore } = usePagedList(
  ({ current, size }) =>
    fetchGamePosts(gameId.value, { boardId: boardIdOfTab(), sort: SORT.LATEST, current, size })
)

/** 把本页已知的平台回填给每条帖子（列表接口不带 platform） */
const shownList = computed(() => {
  const plat = (game.value && game.value.platform) || ''
  if (!plat) return list.value
  return list.value.map((p) => (p.platform ? p : { ...p, platform: plat }))
})

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
  color: #a49eb6;
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
  color: #a49eb6;
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
  color: #8b8599;
  padding: 24rpx 0 10rpx;
}
</style>

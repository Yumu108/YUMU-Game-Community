<template>
  <view class="mp-page">
    <scroll-view scroll-x class="chips">
      <view class="chips__inner">
        <view
          v-for="s in sorts"
          :key="s.value"
          class="chip"
          :class="{ 'chip--on': sort === s.value }"
          @click="pickSort(s.value)"
        >
          {{ s.label }}
        </view>
      </view>
    </scroll-view>

    <Skeleton v-if="loading" :rows="3" />
    <template v-else>
      <PostCard v-for="p in list" :key="p.id" :post="p" />
      <ErrorState
        v-if="failed"
        icon="📡"
        text="内容加载失败"
        sub="检查网络后重试，或下拉刷新"
        @retry="reload"
      />
      <EmptyState v-else-if="!list.length" icon="📄" text="这个分类还没有内容" />
      <view v-if="list.length" class="footer" @click="retryMore">{{ footerText }}</view>
    </template>
  </view>
</template>

<script setup>
/**
 * 通用内容列表页 —— 首页各模块「更多」的落点。
 * 通过路由参数决定看哪个板块 / 哪个游戏 / 哪种排序，避免为每个入口单独建页。
 *
 * 用法：/pages/list/list?boardId=1&title=攻略心得&sort=hot
 */
import { ref } from 'vue'
import { onLoad, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { fetchPosts } from '../../api/community'
import { SORT } from '../../api/config'
import { usePagedList } from '../../utils/usePagedList'
import PostCard from '../../components/PostCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

const sorts = [
  { label: '最新', value: SORT.LATEST },
  { label: '热门', value: SORT.HOT },
  { label: '精华', value: SORT.ESSENCE },
  { label: '最多回复', value: SORT.REPLY },
  { label: '最多收藏', value: SORT.FAVORITE }
]

const boardId = ref(null)
const gameId = ref(null)
const sort = ref(SORT.LATEST)

const { list, loading, failed, footerText, reload, loadMore, retryMore } = usePagedList(
  ({ current, size }) =>
    fetchPosts({
      boardId: boardId.value || undefined,
      gameId: gameId.value || undefined,
      sort: sort.value,
      current,
      size
    })
)

function pickSort(v) {
  if (sort.value === v) return
  sort.value = v
  reload()
}

onLoad((q = {}) => {
  boardId.value = q.boardId ? Number(q.boardId) : null
  gameId.value = q.gameId ? Number(q.gameId) : null
  if (q.sort) sort.value = q.sort
  if (q.title) {
    uni.setNavigationBarTitle({ title: decodeURIComponent(q.title) })
  }
  reload()
})

onReachBottom(loadMore)

onPullDownRefresh(async () => {
  await reload()
  uni.stopPullDownRefresh()
})
</script>

<style scoped>
.chips {
  white-space: nowrap;
  width: 100%;
  margin-bottom: 22rpx;
}
.chips__inner {
  display: inline-flex;
}
.chip {
  flex: none;
  padding: 10rpx 28rpx;
  border-radius: 30rpx;
  background: #231f31;
  font-size: 25rpx;
  color: #c8c3d6;
  border: 1rpx solid transparent;
  margin-right: 14rpx;
}
.chip--on {
  background: rgba(124, 92, 255, 0.2);
  border-color: #7c5cff;
  color: #cbbdff;
}
.footer {
  text-align: center;
  font-size: 23rpx;
  color: #6f6a80;
  padding: 24rpx 0 10rpx;
}
</style>

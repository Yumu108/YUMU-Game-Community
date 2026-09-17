<template>
  <view class="mp-page">
    <!-- 公告（⚠️ 线上当前 0 条，有数据时自动出现） -->
    <view v-if="announcements.length" class="notice">
      <text class="notice__label">📢 公告</text>
      <view v-for="a in announcements" :key="a.id" class="notice__item">
        <text class="notice__text">{{ a.title }}</text>
      </view>
    </view>

    <!-- 排序 -->
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
        text="资讯加载失败"
        sub="检查网络后重试，或下拉刷新"
        @retry="reload"
      />
      <EmptyState v-else-if="!list.length" icon="📰" text="暂无资讯" sub="稍后再来看看" />
      <view v-if="list.length" class="footer" @click="retryMore">{{ footerText }}</view>
    </template>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { fetchPosts, fetchAnnouncements } from '../../api/community'
import { BOARD, SORT } from '../../api/config'
import { usePagedList } from '../../utils/usePagedList'
import PostCard from '../../components/PostCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

const sorts = [
  { label: '最新', value: SORT.LATEST },
  { label: '热门', value: SORT.HOT },
  { label: '最多回复', value: SORT.REPLY },
  { label: '最多收藏', value: SORT.FAVORITE }
]

const sort = ref(SORT.LATEST)
const announcements = ref([])

// fetcher 里读的是 sort.value 的**当前值**，所以切排序后 reload 即生效
const { list, loading, failed, footerText, reload, loadMore, retryMore } = usePagedList(
  ({ current, size }) => fetchPosts({ boardId: BOARD.NEWS, sort: sort.value, current, size })
)

function pickSort(v) {
  if (sort.value === v) return
  sort.value = v
  reload()
}

onLoad(async () => {
  await reload()
  // 公告可能为空 → 静默获取，失败或空数组都不影响资讯流
  try {
    const a = await fetchAnnouncements()
    announcements.value = Array.isArray(a) ? a.slice(0, 3) : []
  } catch (e) {
    announcements.value = []
  }
})

onReachBottom(loadMore)

onPullDownRefresh(async () => {
  await reload()
  uni.stopPullDownRefresh()
})
</script>

<style scoped>
.notice {
  background: #221d33;
  border: 1rpx solid #332c4a;
  border-radius: 22rpx;
  padding: 22rpx;
  margin-bottom: 20rpx;
}
.notice__label {
  display: block;
  font-size: 24rpx;
  color: #f0b45f;
  margin-bottom: 10rpx;
}
.notice__item {
  margin-top: 8rpx;
}
.notice__text {
  font-size: 26rpx;
  color: #e9e7f2;
}

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

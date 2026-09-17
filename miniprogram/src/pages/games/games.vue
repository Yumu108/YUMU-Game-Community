<template>
  <view class="mp-page">
    <!-- 关键词搜索 -->
    <view class="search">
      <text class="search__icon">🔍</text>
      <input
        class="search__input"
        v-model="keyword"
        type="text"
        confirm-type="search"
        placeholder="搜索游戏名"
        placeholder-class="search__ph"
        @confirm="reload"
      />
      <text v-if="keyword" class="search__clear" @click="clearKeyword">✕</text>
    </view>

    <!-- 平台筛选 -->
    <scroll-view scroll-x class="chips">
      <view class="chips__inner">
        <view
          v-for="p in platforms"
          :key="p.value"
          class="chip"
          :class="{ 'chip--on': platform === p.value }"
          @click="pickPlatform(p.value)"
        >
          {{ p.label }}
        </view>
      </view>
    </scroll-view>

    <!-- 列表 -->
    <Skeleton v-if="loading" :rows="3" />
    <template v-else>
      <view v-for="g in list" :key="g.id" class="gitem" @click="goGame(g)">
        <GameTile :game="g" size="md" />
        <view class="gitem__body">
          <text class="gitem__name">{{ g.name }}</text>
          <text class="gitem__desc mp-clamp-2">{{ g.description || g.developer || '暂无简介' }}</text>
          <view class="gitem__tags">
            <text v-if="g.platform" class="mp-tag mp-tag--purple">{{ g.platform }}</text>
            <text v-if="g.genre" class="mp-tag">{{ g.genre }}</text>
            <text class="gitem__count">
              <text class="mp-num">{{ g.postCount || 0 }}</text> 帖
            </text>
          </view>
        </view>
      </view>

      <!-- 🚨 失败态优先于空态：连不上后端时绝不能显示「没有找到匹配的游戏」 -->
      <ErrorState
        v-if="failed"
        icon="📡"
        text="游戏库加载失败"
        sub="检查网络后重试，或下拉刷新"
        @retry="reload"
      />
      <EmptyState
        v-else-if="!list.length"
        icon="🔍"
        text="没有找到匹配的游戏"
        sub="换个关键词或清掉筛选试试"
      />

      <!-- 上拉加载状态 -->
      <view v-if="list.length" class="footer" @click="onFooterTap">{{ footerText }}</view>
    </template>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { fetchGames } from '../../api/community'
import GameTile from '../../components/GameTile.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

const PAGE_SIZE = 12

/** 平台取值来自线上实测：多平台 6 / 手机 6 / PC 5 / 主机 1 */
const platforms = [
  { label: '全部', value: '' },
  { label: '多平台', value: '多平台' },
  { label: '手机', value: '手机' },
  { label: 'PC', value: 'PC' },
  { label: '主机', value: '主机' }
]

const keyword = ref('')
const platform = ref('')
const list = ref([])
const loading = ref(true)
const current = ref(1)
const total = ref(0)
const noMore = ref(false)
const failed = ref(false) // 首屏/刷新失败
const moreFailed = ref(false) // 上拉这一页失败

const footerText = computed(() => {
  if (moreFailed.value) return '加载失败，点此重试'
  if (noMore.value) return `已加载全部 ${total.value} 款`
  return '上拉加载更多'
})

/**
 * 🚨 分页参数是 `current`，不是 `page`。
 *   传 `page` 会被后端静默忽略、恒返回第 1 页 —— 上拉加载会无限重复第一页。
 */
async function load(reset = false) {
  if (reset) {
    current.value = 1
    noMore.value = false
    failed.value = false
    moreFailed.value = false
  }
  loading.value = reset
  try {
    const res = await fetchGames({
      current: current.value,
      size: PAGE_SIZE,
      keyword: keyword.value || undefined,
      platform: platform.value || undefined
    })
    const records = (res && res.records) || []
    total.value = (res && res.total) || 0
    list.value = reset ? records : list.value.concat(records)
    moreFailed.value = false
    if (list.value.length >= total.value || !records.length) noMore.value = true
  } catch (e) {
    if (reset) {
      // 失败 ≠ 空数据：清掉旧数据，标记失败，由 ErrorState 接管渲染
      list.value = []
      failed.value = true
    } else {
      // 页码回退，否则重试会直接跳过这一页
      current.value = Math.max(1, current.value - 1)
      moreFailed.value = true
    }
  } finally {
    loading.value = false
  }
}

function reload() {
  load(true)
}

/** 底部「加载失败，点此重试」 */
function onFooterTap() {
  if (!moreFailed.value) return
  current.value += 1
  moreFailed.value = false
  load(false)
}

function clearKeyword() {
  keyword.value = ''
  reload()
}

function pickPlatform(v) {
  if (platform.value === v) return
  platform.value = v
  reload()
}

onLoad(() => load(true))

onReachBottom(() => {
  // 上一页失败时不自动重试：否则会在触底处疯狂重连，用户只能手动点底部重试
  if (noMore.value || loading.value || moreFailed.value) return
  current.value += 1
  load(false)
})

onPullDownRefresh(async () => {
  await load(true)
  uni.stopPullDownRefresh()
})

function goGame(g) {
  uni.navigateTo({ url: `/pages/game/detail?id=${g.id}&name=${encodeURIComponent(g.name || '')}` })
}
</script>

<style scoped>
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
.search__input {
  flex: 1;
  font-size: 27rpx;
  color: #e9e7f2;
}
.search__ph {
  color: #6f6a80;
}
.search__clear {
  font-size: 26rpx;
  color: #6f6a80;
  padding-left: 16rpx;
}

.chips {
  white-space: nowrap;
  width: 100%;
  margin: 20rpx 0 24rpx;
}
.chips__inner {
  display: inline-flex;
}
.chip {
  flex: none;
  padding: 10rpx 26rpx;
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

.gitem {
  display: flex;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 22rpx;
  padding: 22rpx;
  margin-bottom: 18rpx;
}
.gitem__body {
  flex: 1;
  min-width: 0;
  margin-left: 20rpx;
}
.gitem__name {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #e9e7f2;
}
.gitem__desc {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #8b8599;
}
.gitem__tags {
  display: flex;
  align-items: center;
  margin-top: 14rpx;
}
.gitem__tags .mp-tag {
  margin-right: 12rpx;
}
.gitem__count {
  font-size: 22rpx;
  color: #6f6a80;
  margin-left: auto;
}

.footer {
  text-align: center;
  font-size: 23rpx;
  color: #6f6a80;
  padding: 24rpx 0 10rpx;
}
</style>

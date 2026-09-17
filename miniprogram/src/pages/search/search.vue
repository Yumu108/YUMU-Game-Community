<template>
  <view class="mp-page">
    <!-- 搜索框 -->
    <view class="search">
      <text class="search__icon">🔍</text>
      <input
        class="search__input"
        v-model="keyword"
        type="text"
        confirm-type="search"
        placeholder="搜索游戏 / 攻略 / 资讯"
        placeholder-class="search__ph"
        focus
        @confirm="doSearch"
      />
      <text v-if="keyword" class="search__clear" @click="clearAll">✕</text>
    </view>

    <!-- 类型切换 -->
    <view v-if="searched" class="tabs">
      <view
        v-for="t in types"
        :key="t.value"
        class="tabs__item"
        :class="{ 'tabs__item--on': type === t.value }"
        @click="pickType(t.value)"
      >
        {{ t.label }}
      </view>
    </view>

    <!-- 未搜索：热门标签 -->
    <template v-if="!searched">
      <view class="mp-sec">
        <text class="mp-sec__title">🔥 热门标签</text>
      </view>
      <view class="tagbox">
        <text v-for="t in hotTags" :key="t.id || t.name" class="tag" @click="useTag(t.name)">
          {{ t.name }}
        </text>
      </view>
      <EmptyState v-if="!hotTags.length" icon="🏷" text="暂无热门标签" />
    </template>

    <!-- 搜索结果 -->
    <template v-else>
      <Skeleton v-if="loading" :rows="2" />

      <template v-else>
        <ErrorState
          v-if="failed"
          icon="📡"
          text="搜索失败"
          sub="检查网络后重试"
          @retry="reload"
        />

        <template v-else>
          <!-- 游戏结果 -->
          <view v-if="games.length" class="mp-sec">
            <text class="mp-sec__title">🎮 游戏</text>
          </view>
          <view v-for="g in games" :key="'g' + g.id" class="gitem" @click="goGame(g)">
            <GameTile :game="g" size="sm" />
            <view class="gitem__body">
              <text class="gitem__name">{{ g.name }}</text>
              <text class="gitem__desc mp-clamp-2">{{ g.description || g.developer || '' }}</text>
            </view>
          </view>

          <!-- 帖子结果 -->
          <view v-if="posts.length" class="mp-sec">
            <text class="mp-sec__title">📄 帖子</text>
          </view>
          <PostCard v-for="p in posts" :key="'p' + p.id" :post="p" />

          <EmptyState
            v-if="!games.length && !posts.length"
            icon="🔍"
            text="没有找到相关内容"
            sub="换个关键词试试"
          />

          <!-- 帖子/综合结果才分页；游戏结果由后端一次性返回，不显示加载条 -->
          <view v-if="type !== 'game' && posts.length" class="footer" @click="retryMore">
            {{ footerText }}
          </view>
        </template>
      </template>
    </template>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onReachBottom } from '@dcloudio/uni-app'
import { searchAll, fetchHotTags } from '../../api/community'
import { usePagedList } from '../../utils/usePagedList'
import GameTile from '../../components/GameTile.vue'
import PostCard from '../../components/PostCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

const types = [
  { label: '综合', value: 'all' },
  { label: '帖子', value: 'post' },
  { label: '游戏', value: 'game' }
]

const keyword = ref('')
const type = ref('all')
const searched = ref(false)
const games = ref([])
const hotTags = ref([])

/**
 * 🚨 搜索结果必须能翻页：原来写死 `size:20` 且没有上拉加载，
 *   搜「原神」这种热门词命中 50+ 条，页面只给前 20 条、下面的**凭空消失**，
 *   用户还以为只有 20 条。现在走统一分页。
 *
 * 结构随 type 变化：
 *  · type=all  → { posts: PageResult, boards, users, games }
 *  · type=post → PageResult
 *  · type=game → 游戏数组（后端不分页）
 */
const { list: posts, loading, failed, footerText, reload, loadMore, retryMore } = usePagedList(
  async ({ current, size }) => {
    const res = await searchAll(keyword.value, type.value, { current, size })
    if (type.value === 'all') {
      games.value = (res && res.games) || []
      const p = (res && res.posts) || {}
      return { total: p.total || 0, records: p.records || [] }
    }
    if (type.value === 'post') return res
    games.value = Array.isArray(res) ? res : (res && res.records) || []
    return { total: games.value.length, records: [] }
  }
)

onLoad(async (q = {}) => {
  if (q.keyword) {
    keyword.value = decodeURIComponent(q.keyword)
    doSearch()
  }
  try {
    const t = await fetchHotTags(12)
    hotTags.value = Array.isArray(t) ? t : []
  } catch (e) {
    hotTags.value = []
  }
})

async function doSearch() {
  const kw = keyword.value.trim()
  if (!kw) {
    searched.value = false
    posts.value = []
    games.value = []
    return
  }
  searched.value = true
  games.value = []
  await reload()
}

function pickType(v) {
  if (type.value === v) return
  type.value = v
  doSearch()
}

function useTag(name) {
  keyword.value = name
  doSearch()
}

function clearAll() {
  keyword.value = ''
  searched.value = false
  posts.value = []
  games.value = []
}

onReachBottom(() => {
  if (type.value === 'game') return
  loadMore()
})

function goGame(g) {
  uni.navigateTo({ url: `/pages/game/detail?id=${g.id}&name=${encodeURIComponent(g.name || '')}` })
}
</script>

<style scoped>
.search {
  height: 76rpx;
  border-radius: 38rpx;
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
  font-size: 28rpx;
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

.tabs {
  display: flex;
  margin-top: 22rpx;
  background: #231f31;
  border-radius: 16rpx;
  padding: 6rpx;
}
.tabs__item {
  flex: 1;
  text-align: center;
  font-size: 26rpx;
  color: #8b8599;
  padding: 12rpx 0;
  border-radius: 12rpx;
}
.tabs__item--on {
  background: rgba(124, 92, 255, 0.22);
  color: #cbbdff;
}

.tagbox {
  display: flex;
  flex-wrap: wrap;
}
.tag {
  font-size: 25rpx;
  color: #c8c3d6;
  background: #231f31;
  border-radius: 30rpx;
  padding: 12rpx 28rpx;
  margin: 0 16rpx 16rpx 0;
}

.gitem {
  display: flex;
  align-items: center;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 22rpx;
  padding: 20rpx;
  margin-bottom: 16rpx;
}
.gitem__body {
  flex: 1;
  min-width: 0;
  margin-left: 18rpx;
}
.gitem__name {
  display: block;
  font-size: 29rpx;
  font-weight: 600;
  color: #e9e7f2;
}
.gitem__desc {
  display: block;
  margin-top: 6rpx;
  font-size: 23rpx;
  color: #8b8599;
}

.footer {
  text-align: center;
  font-size: 23rpx;
  color: #6f6a80;
  padding: 24rpx 0 10rpx;
}
</style>

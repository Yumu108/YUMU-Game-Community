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
        placeholder="搜索攻略 / 游戏名"
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
      <!--
        🚨 帖子结果走**端内索引**搜索，不走 `/search` —— 因为后端搜索会把
          吐槽 / 玩家天地 / 其他等板块的帖子一并返回，而本端的口径是「只收干货」
          （见 docs/方案设计.md §二）。端内搜既能保证范围正确，又是**零请求、即输即出**。
      -->
      <view v-if="type !== 'game'" class="hint">
        <text class="hint__text">
          在 {{ poolSize }} 篇攻略 / 资讯中搜索{{ keyword ? `「${keyword}」` : '' }}
        </text>
      </view>

      <Skeleton v-if="loading" :rows="2" />

      <template v-else>
        <ErrorState
          v-if="failed"
          icon="📡"
          text="搜索失败"
          sub="检查网络后重试"
          @retry="reloadGames"
        />

        <template v-else>
          <!-- 游戏结果 -->
          <view v-if="type !== 'post' && games.length" class="mp-sec">
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
          <view v-if="type !== 'game' && hits.length" class="mp-sec">
            <text class="mp-sec__title">📄 攻略 / 资讯</text>
            <text class="mp-sec__more">共 {{ hits.length }} 篇</text>
          </view>
          <PostCard v-for="p in visibleHits" :key="'p' + p.id" :post="p" />

          <EmptyState
            v-if="!games.length && !hits.length"
            icon="🔍"
            text="没有找到相关内容"
            sub="换个关键词试试"
          />

          <view v-if="type !== 'game' && hits.length > visibleHits.length" class="more" @click="showMore">
            <text class="more__text">查看更多（还有 {{ hits.length - visibleHits.length }} 篇）</text>
          </view>
        </template>
      </template>
    </template>
  </view>
</template>

<script setup>
/**
 * 搜索页 —— 双通道：
 *   · **帖子**：端内索引搜索（零请求、范围锁定在干货池、结果即时）
 *   · **游戏**：走后端 `/search?type=game`（游戏是服务端数据，端内没有全量索引）
 *
 * 为什么不用 `/search?type=post`：后端搜索是**全站**范围，会把吐槽 / 玩家天地 /
 * 其他板块的帖子也带出来，与小程序的干货口径不符；而且它每翻一页都要一次请求，
 * 端内索引已经在内存里，搜索是纯粹的内存过滤。
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { searchAll, fetchHotTags } from '../../api/community'
import { ensureIndex, queryIndex } from '../../utils/guideIndex'
import GameTile from '../../components/GameTile.vue'
import PostCard from '../../components/PostCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

const PAGE = 10

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
const loading = ref(false)
const failed = ref(false)

/** 端内索引（干货池） */
const items = ref([])
const visibleCount = ref(PAGE)

const poolSize = computed(() => items.value.length)
const hits = computed(() => (searched.value ? queryIndex(items.value, { keyword: keyword.value }) : []))
const visibleHits = computed(() => hits.value.slice(0, visibleCount.value))

async function loadIndex() {
  try {
    const res = await ensureIndex({})
    items.value = res.items || []
  } catch (e) {
    items.value = []
  }
}

async function loadGames() {
  failed.value = false
  try {
    const res = await searchAll(keyword.value, 'game')
    games.value = Array.isArray(res) ? res : (res && res.records) || []
  } catch (e) {
    games.value = []
    // 帖子结果来自本地，仍可用；只有「游戏」这一路失败时给出失败态
    failed.value = true
  }
}

async function doSearch() {
  const kw = keyword.value.trim()
  if (!kw) {
    searched.value = false
    games.value = []
    return
  }
  searched.value = true
  visibleCount.value = PAGE
  loading.value = true
  // 帖子命中是同步的（索引在内存），游戏要发一次请求；两者一起等，避免页面先空后跳
  await loadGames()
  loading.value = false
}

function pickType(v) {
  if (type.value === v) return
  type.value = v
  visibleCount.value = PAGE
}

function useTag(name) {
  keyword.value = name
  doSearch()
}

function showMore() {
  visibleCount.value = Math.min(visibleCount.value + PAGE, hits.value.length)
}

function clearAll() {
  keyword.value = ''
  searched.value = false
  games.value = []
  visibleCount.value = PAGE
}

function reloadGames() {
  doSearch()
}

onLoad(async (q = {}) => {
  await loadIndex()
  try {
    const t = await fetchHotTags(12)
    hotTags.value = Array.isArray(t) ? t : []
  } catch (e) {
    hotTags.value = []
  }
  if (q.keyword) {
    keyword.value = decodeURIComponent(q.keyword)
    doSearch()
  }
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
  color: #8b8599;
}
.search__clear {
  font-size: 26rpx;
  color: #8b8599;
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
  color: #a49eb6;
  padding: 12rpx 0;
  border-radius: 12rpx;
}
.tabs__item--on {
  background: rgba(124, 92, 255, 0.22);
  color: #cbbdff;
}

.hint {
  margin-top: 20rpx;
}
.hint__text {
  font-size: 22rpx;
  color: #8b8599;
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
  color: #a49eb6;
}

.more {
  margin-top: 6rpx;
  padding: 22rpx 0;
  text-align: center;
  background: #1a1725;
  border: 1rpx dashed #332d45;
  border-radius: 16rpx;
}
.more__text {
  font-size: 25rpx;
  color: #a99cf0;
}
</style>

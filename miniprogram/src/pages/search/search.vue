<template>
  <view class="mp-page">
    <!-- 搜索框 —— 输入即搜（300ms 防抖），回车可立即查 -->
    <view class="search">
      <text class="search__icon">🔍</text>
      <input
        class="search__input"
        v-model="keyword"
        type="text"
        confirm-type="search"
        placeholder="搜索攻略 / 游戏名 / 类型"
        placeholder-class="search__ph"
        focus
        @input="scheduleSearch"
        @confirm="onSearchNow"
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

    <!-- 未搜索：最近搜索 + 热门标签 -->
    <template v-if="!searched">
      <template v-if="history.length">
        <view class="mp-sec">
          <text class="mp-sec__title">🕘 最近搜索</text>
          <text class="mp-sec__more" @click="onClearHistory">清空</text>
        </view>
        <view class="tagbox">
          <text
            v-for="h in history"
            :key="'h' + h"
            class="tag tag--his"
            @click="useTag(h)"
          >
            {{ h }}
          </text>
        </view>
      </template>

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
        <!-- 游戏结果 —— 走 `/games`（服务端分页），不是 `/search?type=game`（只有 8 条、无总数） -->
        <template v-if="type !== 'post'">
          <ErrorState
            v-if="gamesFailed"
            icon="📡"
            text="游戏搜索失败"
            sub="检查网络后重试（上面攻略结果不受影响）"
            @retry="reloadGames"
          />
          <template v-else>
            <view v-if="games.length" class="mp-sec">
              <text class="mp-sec__title">🎮 游戏</text>
              <text class="mp-sec__more">共 {{ gamesTotal }} 款</text>
            </view>
            <!-- 命中口径提示：只有整列表被同一条筛选命中时才显示（避免每张卡片重复一遍） -->
            <view v-if="games.length && filterHint" class="filterhint">
              <text class="filterhint__text">{{ filterHint }}</text>
            </view>
            <view v-for="g in games" :key="'g' + g.id" class="gitem" @click="goGame(g)">
              <GameTile :game="g" size="sm" />
              <view class="gitem__body">
                <text class="gitem__name">{{ g.name }}</text>
                <text class="gitem__desc mp-clamp-2">{{ g.description || g.developer || '' }}</text>
                <!-- 命中原因回显：回答「这条为什么被搜出来」 -->
                <view v-if="reasonOf(g)" class="gitem__hit">
                  <text class="gitem__hit-text">{{ reasonOf(g) }}</text>
                </view>
              </view>
            </view>
            <view v-if="games.length && !gamesNoMore" class="more more--games" @click="loadMoreGames">
              <text class="more__text">{{ gamesLoading ? '加载中…' : '加载更多游戏' }}</text>
            </view>
          </template>
        </template>

        <!-- 帖子结果（端内索引） -->
        <template v-if="type !== 'game'">
          <view v-if="hits.length" class="mp-sec">
            <text class="mp-sec__title">📄 攻略 / 资讯</text>
            <text class="mp-sec__more">共 {{ hits.length }} 篇</text>
          </view>
          <PostCard v-for="p in visibleHits" :key="'p' + p.id" :post="p" />
          <view v-if="hits.length > visibleHits.length" class="more" @click="showMore">
            <text class="more__text">查看更多（还有 {{ hits.length - visibleHits.length }} 篇）</text>
          </view>
        </template>

        <EmptyState
          v-if="noResult"
          icon="🔍"
          text="没有找到相关内容"
          sub="换个关键词，或试试游戏名 / 类型（如 RPG）"
        />
      </template>
    </template>
  </view>
</template>

<script setup>
/**
 * 搜索页 —— 双通道：
 *   · **帖子**：端内索引搜索（零请求、范围锁定在干货池、结果即时）
 *   · **游戏**：走 `/games`（服务端分页，能翻页、有 total）
 *
 * ==================== 2026-09-21 重构：游戏一路换接口 ====================
 * 原来游戏走 `/search?type=game`。用户在搜索页搜「资讯」，搜出了《仙剑奇侠传》
 * —— 查下来是该接口把 `publisher`（大宇**资讯**）也当匹配字段，属于公司名撞词。
 * 顺着挖出三个真问题：
 *   ① **两处口径不一致**：同一个词，搜索页 1 条、游戏库 0 条（那边只 like 名称/简介）；
 *   ② `/search?type=game` 内部是 `LIMIT 8`，**不能翻页、没有总数**（搜「手机」直接顶满）；
 *   ③ 命中原因不可见 —— 用户不知道结果为什么被搜出来。
 *
 * 现在：游戏改走 `/games`（有分页 + total），关键词先由端内解析成
 * 类型 / 平台**精确值**（`utils/keywordFilter.js`，与游戏库页共用同一份），
 * 再把命中原因回显到卡片上。**后端零改动。**
 *
 * 为什么不用 `/search?type=post`：后端搜索是**全站**范围，会把吐槽 / 玩家天地 /
 * 其他板块的帖子也带出来，与小程序的干货口径不符；而且它每翻一页都要一次请求，
 * 端内索引已经在内存里，搜索是纯粹的内存过滤。
 */
import { ref, computed, onUnmounted } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { fetchGames, fetchHotTags } from '../../api/community'
import { ensureIndex, ensureGameMeta, queryIndex } from '../../utils/guideIndex'
import { matchGenre, matchPlatform } from '../../utils/keywordFilter'
import { getSearchHistory, addSearchHistory, clearSearchHistory } from '../../utils/searchHistory'
import { platformLabel } from '../../utils/format'
import GameTile from '../../components/GameTile.vue'
import PostCard from '../../components/PostCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

/** 帖子「查看更多」的步长 */
const PAGE = 10
/** 游戏分页大小（与游戏库页一致，翻页观感统一） */
const GAME_PAGE = 12
/** 输入防抖：停止输入多久后才真正去查 */
const DEBOUNCE = 300
/**
 * 记搜索历史的防抖 —— **故意比搜素防抖长得多**。
 *
 * 📌 若按 300ms 就记，用户打「原神」会在历史里留下「原」「原神」两条半截词。
 *   1.5s 的空闲门槛意味着：只有「打完停手了」才算一次真正的搜索。
 *   回车 / 点标签 / 离开页面另有立即记录的路径，不会漏记。
 */
const HISTORY_DEBOUNCE = 1500

const types = [
  { label: '综合', value: 'all' },
  { label: '帖子', value: 'post' },
  { label: '游戏', value: 'game' }
]

const keyword = ref('')
const type = ref('all')
const searched = ref(false)
const loading = ref(false)

/** 端内索引（干货池） */
const items = ref([])
/** 类型清单 —— 只用于把搜索词解析成 genre，不再当筛选 UI（见 2026-09-20 那轮调整） */
const genres = ref([])
const hotTags = ref([])
const history = ref([])
const visibleCount = ref(PAGE)

/** 游戏结果（服务端分页） */
const games = ref([])
const gamesTotal = ref(0)
const gamesCurrent = ref(1)
const gamesNoMore = ref(true)
const gamesLoading = ref(false)
const gamesFailed = ref(false)

/** 请求序号：关键词变化很快，用它丢弃「过期响应」，避免旧结果盖掉新结果 */
let reqSeq = 0
let searchTimer = null
let historyTimer = null

const poolSize = computed(() => items.value.length)
const hits = computed(() => (searched.value ? queryIndex(items.value, { keyword: keyword.value }) : []))
const visibleHits = computed(() => hits.value.slice(0, visibleCount.value))

/**
 * 关键词解析成精确筛选值。
 * ⚠️ **不依赖当前 Tab** —— 否则「切到帖子再切回游戏」会让列表与筛选口径对不上。
 */
const kwGenre = computed(() => matchGenre(keyword.value, genres.value))
const kwPlatform = computed(() => (kwGenre.value ? '' : matchPlatform(keyword.value)))

/** 整列表级的命中口径提示（有筛选时才显示） */
const filterHint = computed(() => {
  if (kwGenre.value) return `已按「类型 · ${kwGenre.value}」筛选`
  if (kwPlatform.value) return `已按「平台 · ${platformLabel(kwPlatform.value)}」筛选`
  return ''
})

/** 当前 Tab 下是否真的「一条都没有」（用于空态；失败态另有 ErrorState，不能算空） */
const noResult = computed(() => {
  const g = type.value === 'post' ? 0 : games.value.length
  const p = type.value === 'game' ? 0 : hits.value.length
  return !g && !p && !gamesFailed.value
})

/* ==================== 端内索引 / 元数据 ==================== */

async function loadIndex() {
  try {
    const res = await ensureIndex({})
    items.value = res.items || []
  } catch (e) {
    items.value = []
  }
  try {
    // 类型清单来自与游戏库页**同一份缓存**（ensureGameMeta 自带缓存，这里几乎是零成本）
    const meta = await ensureGameMeta()
    genres.value = meta.genres || []
  } catch (e) {
    genres.value = []
  }
}

/* ==================== 游戏结果 ==================== */

/**
 * @param {boolean} reset true=从第 1 页重取（新关键词）；false=加载下一页
 */
async function loadGames(reset = true) {
  const kw = keyword.value.trim()
  if (!kw) return
  if (reset) {
    gamesCurrent.value = 1
    gamesNoMore.value = false
    gamesFailed.value = false
  }

  const my = ++reqSeq
  gamesLoading.value = true
  try {
    const g = kwGenre.value
    const p = kwPlatform.value
    const res = await fetchGames({
      current: gamesCurrent.value,
      size: GAME_PAGE,
      // 命中类型 / 平台时改走精确筛选，**不再传 keyword**：
      // `/games` 的 keyword 只 like 名称/简介，一起传会被它「反抢」出无关结果
      keyword: g || p ? undefined : kw,
      genre: g || undefined,
      platform: p || undefined
    })
    if (my !== reqSeq) return // 已经有更新的请求了，丢弃这次结果
    const records = (res && res.records) || []
    gamesTotal.value = (res && res.total) || 0
    games.value = reset ? records : games.value.concat(records)
    if (games.value.length >= gamesTotal.value || !records.length) gamesNoMore.value = true
  } catch (e) {
    if (my !== reqSeq) return
    if (reset) {
      games.value = []
      gamesTotal.value = 0
      gamesFailed.value = true
    } else {
      // 页码回退，否则「重试」会跳过这一页
      gamesCurrent.value = Math.max(1, gamesCurrent.value - 1)
    }
  } finally {
    if (my === reqSeq) gamesLoading.value = false
  }
}

/** 触底 / 点「加载更多游戏」 */
function loadMoreGames() {
  if (gamesNoMore.value || gamesLoading.value) return
  gamesCurrent.value += 1
  loadGames(false)
}

function reloadGames() {
  doSearch()
}

/* ==================== 搜索主流程 ==================== */

async function doSearch() {
  const kw = keyword.value.trim()
  if (!kw) {
    resetSearch()
    return
  }
  // 只有「第一次搜」才铺骨架屏：后续边打字边查若每次都铺，页面会一直闪
  const first = !searched.value
  searched.value = true
  visibleCount.value = PAGE
  if (first) loading.value = true
  try {
    await loadGames(true)
  } finally {
    if (first) loading.value = false
  }
}

function resetSearch() {
  searched.value = false
  games.value = []
  gamesTotal.value = 0
  gamesNoMore.value = true
  gamesFailed.value = false
  visibleCount.value = PAGE
  reqSeq++ // 让在途响应作废，避免它回来后又把结果填上
}

/** 输入框每次变化：防抖后再查（不按回车也能出结果） */
function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => doSearch(), DEBOUNCE)

  if (historyTimer) clearTimeout(historyTimer)
  historyTimer = setTimeout(() => commitHistory(), HISTORY_DEBOUNCE)
}

/** 回车：立刻查、立刻记 */
function onSearchNow() {
  if (searchTimer) clearTimeout(searchTimer)
  if (historyTimer) clearTimeout(historyTimer)
  commitHistory()
  doSearch()
}

function commitHistory() {
  const kw = keyword.value.trim()
  if (!kw) return
  history.value = addSearchHistory(kw)
}

function pickType(v) {
  if (type.value === v) return
  type.value = v
  visibleCount.value = PAGE
}

function useTag(name) {
  keyword.value = name
  onSearchNow()
}

function onClearHistory() {
  history.value = clearSearchHistory()
}

function showMore() {
  visibleCount.value = Math.min(visibleCount.value + PAGE, hits.value.length)
}

function clearAll() {
  keyword.value = ''
  if (searchTimer) clearTimeout(searchTimer)
  if (historyTimer) clearTimeout(historyTimer)
  resetSearch()
}

/**
 * 逐条回显「命中原因」。
 *
 * 为什么不做成「每张卡片都写类型」：命中类型 / 平台时整列表口径相同，
 * 已在区块上方用 `filterHint` 说清楚了；卡片这一行留给**逐一不同**的情形
 * （普通关键词搜索时，谁命中名称、谁命中简介）。
 */
function reasonOf(g) {
  if (kwGenre.value) return `类型 · ${kwGenre.value}`
  if (kwPlatform.value) return `平台 · ${platformLabel(kwPlatform.value)}`
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return ''
  if (String(g.name || '').toLowerCase().includes(kw)) return '名称匹配'
  if (String(g.description || '').toLowerCase().includes(kw)) return '简介匹配'
  return '关键词匹配'
}

/* ==================== 生命周期 ==================== */

onLoad(async (q = {}) => {
  history.value = getSearchHistory()
  await loadIndex()
  try {
    const t = await fetchHotTags(12)
    hotTags.value = Array.isArray(t) ? t : []
  } catch (e) {
    hotTags.value = []
  }
  if (q.keyword) {
    keyword.value = decodeURIComponent(q.keyword)
    commitHistory()
    doSearch()
  }
})

onUnload(() => {
  // 离开页面时补记一次：防抖的 1.5s 空闲门槛可能还没到，用户就点结果走了
  if (searched.value) commitHistory()
  if (searchTimer) clearTimeout(searchTimer)
  if (historyTimer) clearTimeout(historyTimer)
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
  if (historyTimer) clearTimeout(historyTimer)
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
/* 最近搜索：用虚线边与「热门标签」区分开，一眼能看出是「我搜过的」 */
.tag--his {
  border: 1rpx dashed #3a3350;
  background: transparent;
}

.filterhint {
  margin: -6rpx 0 14rpx;
}
.filterhint__text {
  font-size: 22rpx;
  color: #a99cf0;
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
.gitem__hit {
  margin-top: 10rpx;
}
/* uni-text 默认 white-space: pre-line，这里要的是不换行的小胶囊 */
.gitem__hit-text {
  display: inline-block;
  white-space: nowrap;
  font-size: 21rpx;
  color: #a99cf0;
  background: rgba(124, 92, 255, 0.14);
  border-radius: 8rpx;
  padding: 4rpx 12rpx;
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

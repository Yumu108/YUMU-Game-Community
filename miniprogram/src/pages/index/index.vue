<template>
  <view class="mp-page">
    <!-- 搜索入口 -->
    <view class="search" @click="goSearch">
      <text class="search__icon">🔍</text>
      <text class="search__ph">搜索游戏 / 攻略 / 资讯</text>
    </view>

    <!--
      定位横幅 —— 一句话说清「这是什么」。
      产品口径：多平台游戏知识的聚合与分类展示端（只收干货攻略/情报，不做闲聊讨论）。
    -->
    <view class="hero">
      <text class="hero__title">多平台游戏攻略库</text>
      <text class="hero__sub">聚合 PC / 主机 / 手游 的攻略心得 · 只收干货</text>
      <view class="hero__stats">
        <view class="hero__stat">
          <text class="hero__num">{{ statText(stats.total) }}</text>
          <text class="hero__label">攻略篇数</text>
        </view>
        <view class="hero__divider" />
        <view class="hero__stat">
          <text class="hero__num">{{ statText(stats.games) }}</text>
          <text class="hero__label">覆盖游戏</text>
        </view>
        <view class="hero__divider" />
        <view class="hero__stat">
          <text class="hero__num">{{ statText(stats.platforms) }}</text>
          <text class="hero__label">平台档位</text>
        </view>
      </view>
    </view>

    <!-- 同步失败但用的是旧内容：必须明说，不能让用户以为这就是最新的 -->
    <view v-if="stale" class="warn" @click="sync(true)">
      <text class="warn__text">⚠️ 内容同步失败，当前显示的是上次同步结果（{{ syncTimeText }}）。点此重试</text>
    </view>

    <!--
      平台筛选 —— 本页的**核心交互**。
      数字取自端内索引的真实计数，与筛出来的条数必然一致。
    -->
    <PlatformFilter
      v-model:value="platform"
      :tabs="platTabs"
      title="按平台筛选"
      :hint="platHint"
      @change="onFilterChange"
    />

    <!-- 排序 + 结果计数 -->
    <view class="bar">
      <view class="bar__chips">
        <view
          v-for="s in sorts"
          :key="s.value"
          class="sortchip"
          :class="{ 'sortchip--on': sort === s.value }"
          @click="pickSort(s.value)"
        >
          {{ s.label }}
        </view>
      </view>
      <text class="bar__count">共 {{ filtered.length }} 篇</text>
    </view>

    <!-- 公告（有正文，点开看全文 —— 原来只渲染标题且不可点） -->
    <view v-if="topNotice" class="notice" @click="openNotice(topNotice)">
      <text class="notice__tag">📢 公告</text>
      <text class="notice__text mp-ellipsis">{{ topNotice.title }}</text>
      <text class="notice__more">查看 ›</text>
    </view>

    <!-- 首屏 / 同步中 -->
    <Skeleton v-if="loading" :rows="3" />

    <!-- 同步失败且无旧内容可回退 -->
    <ErrorState
      v-else-if="failed"
      icon="📡"
      text="内容同步失败"
      :sub="errMsg"
      @retry="sync(true)"
    />

    <template v-else>
      <PostCard v-for="p in visible" :key="p.id" :post="p" />

      <EmptyState
        v-if="!filtered.length"
        icon="🧭"
        :text="platform ? `「${platLabelOf(platform)}」还没有攻略` : '还没有内容'"
        sub="换个平台看看"
      />

      <view v-if="filtered.length" class="footer" @click="loadMore">{{ footerText }}</view>
    </template>

    <!-- 公告详情浮层 -->
    <view v-if="noticeOpen" class="sheet" @click="noticeOpen = false">
      <view class="sheet__panel" @click.stop>
        <text class="sheet__title">{{ noticeOpen.title }}</text>
        <text v-if="noticeTime(noticeOpen)" class="sheet__time">{{ noticeTime(noticeOpen) }}</text>
        <scroll-view scroll-y class="sheet__body">
          <text class="sheet__text">{{ noticeOpen.content || '（暂无正文）' }}</text>
        </scroll-view>
        <view class="sheet__close" @click="noticeOpen = false">关闭</view>
      </view>
    </view>
  </view>
</template>

<script setup>
/**
 * 首页 = 攻略聚合页。
 *
 * 与旧版的区别（定位调整）：
 *   · 旧版是「社区消费端首页」：热门游戏 + 最新资讯 + 推荐攻略 三块拼盘，无筛选能力；
 *   · 新版是「多平台攻略库」：**平台筛选是主交互**，内容来自端内聚合索引
 *     （与「资讯」页共用同一份索引 ⇒ 两页间切换零请求）。
 *
 * 🚨 内容口径（2026-09-21 起）：本页**只放「攻略心得」(board 1)** 的帖子。
 *   资讯速递整体归底部「资讯」页，两页零重叠 —— 详见下方 `pool` 处注释。
 */
import { ref, computed } from 'vue'
import { onLoad, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { ensureIndex, queryIndex, countByPlatform, indexStats } from '../../utils/guideIndex'
import { fetchAnnouncements } from '../../api/community'
import { PLATFORM_TABS, PLATFORM_HINT, SORT, BOARD } from '../../api/config'
import { platformLabel, formatTime } from '../../utils/format'
import PlatformFilter from '../../components/PlatformFilter.vue'
import PostCard from '../../components/PostCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

/** 本地分页步长：索引已在内存里，一屏给 12 条足够，多了反而白渲染 */
const PAGE = 12

const sorts = [
  { label: '最新', value: SORT.LATEST },
  { label: '最热', value: SORT.HOT },
  { label: '精华', value: SORT.ESSENCE }
]

const items = ref([])
const loading = ref(true)
const failed = ref(false)
const errMsg = ref('')
const stale = ref(false)
const syncedAt = ref(0)
const platform = ref('')
const sort = ref(SORT.LATEST)
const visibleCount = ref(PAGE)
const topNotice = ref(null)
const noticeOpen = ref(null)

/**
 * 攻略页内容池 = 端内索引里 **只取「攻略心得」(board 1)** 的帖子。
 *
 * 🚨 2026-09-21 二次调整（口径变更，别再按老注释理解）：
 *   上一版的做法是「聚合攻略心得 + 资讯速递，再排除官方账号的帖」——
 *   结果攻略页里仍混着资讯速递的玩家投稿，用户看到「攻略和资讯混在一起」。
 *   现在改成**按板块硬切**：
 *     · 本页 = 攻略心得（board 1）**全部**帖（含各类作者的攻略长文）；
 *     · 「资讯」页（`pages/news`）= 资讯速递（board 4）**全部**帖。
 *   两页**零重叠**，官方帖天然只会出现在资讯侧（它发在 board 4），
 *   所以这里不再需要按 `OFFICIAL_UID` 做排除 —— 板块过滤已经蕴含了这层语义。
 *
 * ⚠️ 用 `Number(...)` 归一化再比较：索引经存储往返后 boardId 可能是字符串，
 *   直接全等会让本页**一篇都筛不出来**（页面空、但不报错，属静默错）。
 */
const pool = computed(() => items.value.filter((it) => Number(it.boardId) === BOARD.GUIDE))

const stats = computed(() => indexStats(pool.value))
const counts = computed(() => countByPlatform(pool.value))

/** 按钮上带真实数量；「全部」= 池内总数 */
const platTabs = computed(() =>
  PLATFORM_TABS.map((t) => ({ ...t, count: counts.value[t.value] || 0 }))
)

const platHint = computed(() =>
  platform.value ? PLATFORM_HINT[platform.value] || '' : '全部平台的内容聚合在一起'
)

const filtered = computed(() =>
  queryIndex(pool.value, { platform: platform.value, sort: sort.value })
)
const visible = computed(() => filtered.value.slice(0, visibleCount.value))

const noMore = computed(() => visibleCount.value >= filtered.value.length)
const footerText = computed(() =>
  noMore.value ? `已加载全部 ${filtered.value.length} 篇` : '上拉加载更多'
)

const statText = (n) => (n > 0 ? String(n) : '—')
const platLabelOf = (v) => platformLabel(v)
const syncTimeText = computed(() => (syncedAt.value ? formatTime(new Date(syncedAt.value)) : '未知时间'))
const noticeTime = (a) => formatTime((a && (a.updatedAt || a.createdAt)) || '')

async function sync(force = false) {
  loading.value = true
  failed.value = false
  errMsg.value = ''
  try {
    const res = await ensureIndex({ force })
    items.value = res.items || []
    syncedAt.value = res.at || 0
    stale.value = !!res.stale
    visibleCount.value = PAGE
  } catch (e) {
    // 失败 ≠ 空数据：交给 ErrorState 渲染，绝不掉进 EmptyState
    items.value = []
    stale.value = false
    failed.value = true
    errMsg.value = (e && (e.message || e.errMsg)) || '网络异常，请检查网络后重试'
  } finally {
    loading.value = false
  }
}

function onFilterChange() {
  // 切平台 = 换一批内容，回到第一页；索引在内存里，无需重新请求
  visibleCount.value = PAGE
}

function pickSort(v) {
  if (sort.value === v) return
  sort.value = v
  visibleCount.value = PAGE
}

function loadMore() {
  if (noMore.value) return
  visibleCount.value = Math.min(visibleCount.value + PAGE, filtered.value.length)
}

function openNotice(a) {
  noticeOpen.value = a
}

async function loadNotices() {
  try {
    const a = await fetchAnnouncements()
    topNotice.value = Array.isArray(a) && a.length ? a[0] : null
  } catch (e) {
    topNotice.value = null
  }
}

onLoad(async () => {
  await Promise.all([sync(false), loadNotices()])
})

onReachBottom(loadMore)

onPullDownRefresh(async () => {
  await Promise.all([sync(true), loadNotices()])
  uni.stopPullDownRefresh()
})

function goSearch() {
  uni.navigateTo({ url: '/pages/search/search' })
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
  color: #8b8599;
}

/* 定位横幅 */
.hero {
  margin-top: 20rpx;
  border-radius: 28rpx;
  padding: 30rpx 28rpx 24rpx;
  background: #221d33;
  border: 1rpx solid #332c4a;
}
.hero__title {
  display: block;
  font-size: 38rpx;
  font-weight: 700;
  color: #e9e7f2;
}
.hero__sub {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: #a49eb6;
}
.hero__stats {
  display: flex;
  align-items: center;
  margin-top: 22rpx;
}
.hero__stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.hero__num {
  font-size: 34rpx;
  font-weight: 700;
  color: #b9a9ff;
}
.hero__label {
  margin-top: 6rpx;
  font-size: 21rpx;
  color: #8b8599;
}
.hero__divider {
  width: 1rpx;
  height: 44rpx;
  background: #332c4a;
}

/* 同步失败提示条 */
.warn {
  margin-top: 18rpx;
  padding: 16rpx 20rpx;
  border-radius: 16rpx;
  background: rgba(255, 176, 32, 0.1);
  border: 1rpx solid rgba(255, 176, 32, 0.32);
}
.warn__text {
  font-size: 22rpx;
  color: #ffce7a;
  line-height: 1.6;
}

/* 排序 + 计数 */
.bar {
  display: flex;
  align-items: center;
  margin: 4rpx 0 20rpx;
}
.bar__chips {
  display: flex;
  flex: 1;
  min-width: 0;
}
.sortchip {
  flex: none;
  padding: 8rpx 24rpx;
  border-radius: 28rpx;
  background: #231f31;
  font-size: 24rpx;
  color: #c8c3d6;
  border: 1rpx solid transparent;
  margin-right: 14rpx;
}
.sortchip--on {
  background: rgba(124, 92, 255, 0.2);
  border-color: #7c5cff;
  color: #cbbdff;
  font-weight: 600;
}
.bar__count {
  flex: none;
  font-size: 22rpx;
  color: #8b8599;
}

/* 公告条 */
.notice {
  display: flex;
  align-items: center;
  background: #221d33;
  border: 1rpx solid #332c4a;
  border-radius: 18rpx;
  padding: 18rpx 22rpx;
  margin-bottom: 20rpx;
}
.notice__tag {
  flex: none;
  font-size: 22rpx;
  color: #f0b45f;
  margin-right: 14rpx;
}
.notice__text {
  flex: 1;
  min-width: 0;
  font-size: 25rpx;
  color: #e9e7f2;
}
.notice__more {
  flex: none;
  margin-left: 14rpx;
  font-size: 22rpx;
  color: #b9a9ff;
}

/* 公告详情浮层
 * 🚨 z-index 必须高过 tabBar：uni-app H5 的底栏 z-index 是 998，
 *   原来写 90 ⇒ 浮层底部（连同「关闭」按钮）被底栏盖住，真机上点不到关闭。
 *   （回归 A16「可关闭浮层」就是被这个挡住的，实测报 "tabbar intercepts pointer events"。）
 */
.sheet {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-end;
  z-index: 1200;
}
.sheet__panel {
  width: 100%;
  max-height: 72vh;
  background: #1a1725;
  border-radius: 28rpx 28rpx 0 0;
  border-top: 1rpx solid #332c4a;
  padding: 30rpx 30rpx calc(30rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}
.sheet__title {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  color: #e9e7f2;
}
.sheet__time {
  display: block;
  margin-top: 8rpx;
  font-size: 21rpx;
  color: #8b8599;
}
.sheet__body {
  max-height: 48vh;
  margin-top: 16rpx;
}
.sheet__text {
  font-size: 26rpx;
  color: #cfcade;
  line-height: 1.8;
}
.sheet__close {
  margin-top: 24rpx;
  text-align: center;
  font-size: 26rpx;
  color: #cbbdff;
  background: rgba(124, 92, 255, 0.2);
  border: 1rpx solid #7c5cff;
  border-radius: 30rpx;
  padding: 16rpx 0;
}

.footer {
  text-align: center;
  font-size: 23rpx;
  color: #8b8599;
  padding: 24rpx 0 10rpx;
}
</style>

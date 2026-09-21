<template>
  <view class="mp-page">
    <!--
      今日精选 —— 复用后端 `/picks/daily`（编辑每天挑出来的几条干货）。
      ⚠️ 这个接口线上时有时无（按日期出题），拿不到就整块隐藏，不留空壳。
    -->
    <template v-if="picks.length">
      <view class="mp-sec">
        <text class="mp-sec__title">🎯 今日精选</text>
        <text class="mp-sec__more">编辑推荐</text>
      </view>
      <PostCard v-for="p in picks" :key="'pk' + p.id" :post="p" />
    </template>

    <!-- 平台筛选：与首页同一套档位与计数口径 -->
    <PlatformFilter
      v-model:value="platform"
      :tabs="platTabs"
      title="按平台筛选"
      :hint="platHint"
      @change="onFilterChange"
    />

    <!-- 排序 + 计数 -->
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

    <Skeleton v-if="loading" :rows="3" />

    <ErrorState
      v-else-if="failed"
      icon="📡"
      text="资讯同步失败"
      :sub="errMsg"
      @retry="sync(true)"
    />

    <template v-else>
      <view v-if="stale" class="warn" @click="sync(true)">
        <text class="warn__text">⚠️ 内容同步失败，当前显示的是上次同步结果。点此重试</text>
      </view>

      <PostCard v-for="p in visible" :key="p.id" :post="p" />

      <EmptyState
        v-if="!filtered.length"
        icon="📰"
        :text="platform ? `「${platName(platform)}」还没有资讯` : '还没有资讯'"
        sub="换个平台看看"
      />
      <view v-if="filtered.length" class="footer" @click="loadMore">{{ footerText }}</view>
    </template>
  </view>
</template>

<script setup>
/**
 * 资讯页 = **资讯速递频道**（board 4 全量）。
 *
 * 与首页的关系：两者共用同一份端内索引（`utils/guideIndex.js`）⇒ 切过来**零请求**；
 * 内容池按板块**硬切、零重叠**（2026-09-21 起）：
 *   · 本页 = 资讯速递（board 4）全部：官方公告（`db-seed/fetch_official.py` 抓 Steam
 *     官方公告 + AI 改写）+ 玩家投稿；
 *   · 首页 = 攻略心得（board 1）全部。
 * 官方帖默认置顶 + 加精（落库）：但置顶**只在本页所属的那款游戏详情页内生效**
 * （2026-09-21 用户口径「置顶改成只在游戏详情页内优先」），本页是跨游戏的全景聚合，
 * 所以官方帖按时间正常排布，不再整屏占满首屏。
 *
 * ⚠️ 平台筛选与「今日精选」沿用原逻辑；官方帖也带 gameId ⇒ 平台归类同样有效。
 */
import { ref, computed } from 'vue'
import { onLoad, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { ensureIndex, queryIndex, countByPlatform } from '../../utils/guideIndex'
import { fetchDailyPicks } from '../../api/community'
import { PLATFORM_TABS, PLATFORM_HINT, SORT, BOARD, OFFICIAL_UID } from '../../api/config'
import { platformLabel } from '../../utils/format'
import PlatformFilter from '../../components/PlatformFilter.vue'
import PostCard from '../../components/PostCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

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
const platform = ref('')
const sort = ref(SORT.LATEST)
const visibleCount = ref(PAGE)
const picks = ref([])

/**
 * 本页的内容池 = 索引里 **「资讯速递」(board 4) 的全部帖**。
 *
 * 🚨 2026-09-21 二次调整（口径变更，别再按老注释理解）：
 *   上一版本页是「官方情报站」—— 只出官方账号从游戏官网抓取改写的公告，
 *   资讯速递里的玩家投稿被推回首页。但首页当时是「攻略心得 + 资讯速递」聚合，
 *   于是「攻略」里能看到资讯速递的内容，用户看到的仍是**混在一起**。
 *   现在改成**按板块硬切**：
 *     · 本页 = 资讯速递（board 4）**全部**帖（官方公告 + 玩家投稿）；
 *     · 首页「攻略」页 = 攻略心得（board 1）**全部**帖。
 *   两页**零重叠**。
 *
 * 官方帖怎么凸显（都不在本文件里做判断）：
 *   · `is_essence=1` 是**落库字段**（由 `db-seed/fetch_official.py` 写入）⇒ 带「精华」角标，
 *     且在「精华」排序档里必然入选；
 *   · `is_top=1` 同样是落库字段，但它是**游戏内**语义 —— 端内聚合列表不吃它
 *     （见下方 `scopedTopUid` 与 `guideQuery.makeCmpLatest`）：官方公告应当在
 *     **它所属的那款游戏的详情页**里置顶，而不是把跨游戏的资讯流整屏占满；
 *   · 「官方」角标由 `PostCard` 按 `OFFICIAL_UID` 渲染。
 *
 * ⚠️ 用 `Number(...)` 归一化再比较：索引经存储往返后 boardId 可能是字符串，
 *   直接全等会让本页**一篇都筛不出来**（页面空、但不报错，属静默错）。
 */
const pool = computed(() => items.value.filter((it) => Number(it.boardId) === BOARD.NEWS))
const counts = computed(() => countByPlatform(pool.value))
const platTabs = computed(() =>
  PLATFORM_TABS.map((t) => ({ ...t, count: counts.value[t.value] || 0 }))
)
const platHint = computed(() =>
  platform.value ? PLATFORM_HINT[platform.value] || '' : '全部平台的资讯聚合在一起'
)

/**
 * 筛选 + 排序全部在端内完成（切平台/排序零请求）。
 *
 * 🚨 `scopedTopUid: OFFICIAL_UID`（2026-09-21 用户口径「置顶改成只在游戏详情页内优先」）：
 *   官方帖的 `is_top` 是**游戏内**语义 ⇒ 本页（跨游戏的全景资讯流）不计入排序。
 *   不传的话 20 条官方公告会把首屏 12 张全部占满、玩家投稿被整屏压到下面。
 *   普通用户/版主的置顶不受影响。
 */
const filtered = computed(() =>
  queryIndex(pool.value, {
    platform: platform.value,
    sort: sort.value,
    scopedTopUid: OFFICIAL_UID
  })
)
const visible = computed(() => filtered.value.slice(0, visibleCount.value))
const noMore = computed(() => visibleCount.value >= filtered.value.length)
const footerText = computed(() => (noMore.value ? `已加载全部 ${filtered.value.length} 篇` : '上拉加载更多'))
const platName = (v) => platformLabel(v)

async function sync(force = false) {
  loading.value = true
  failed.value = false
  errMsg.value = ''
  try {
    const res = await ensureIndex({ force })
    items.value = res.items || []
    stale.value = !!res.stale
    visibleCount.value = PAGE
  } catch (e) {
    // 失败 ≠ 空数据
    items.value = []
    stale.value = false
    failed.value = true
    errMsg.value = (e && (e.message || e.errMsg)) || '网络异常，请检查网络后重试'
  } finally {
    loading.value = false
  }
}

async function loadPicks() {
  try {
    const p = await fetchDailyPicks()
    picks.value = Array.isArray(p) ? p.slice(0, 3) : []
  } catch (e) {
    picks.value = [] // 精选是锦上添花，拿不到就不显示
  }
}

function onFilterChange() {
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

onLoad(async () => {
  await Promise.all([sync(false), loadPicks()])
})

onReachBottom(loadMore)

onPullDownRefresh(async () => {
  await Promise.all([sync(true), loadPicks()])
  uni.stopPullDownRefresh()
})
</script>

<style scoped>
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

.warn {
  margin-bottom: 18rpx;
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

.footer {
  text-align: center;
  font-size: 23rpx;
  color: #8b8599;
  padding: 24rpx 0 10rpx;
}
</style>

<template>
  <view class="mp-page">
    <!-- 关键词搜索（带防抖，见 script） -->
    <view class="search">
      <text class="search__icon">🔍</text>
      <input
        class="search__input"
        v-model="keyword"
        type="text"
        confirm-type="search"
        placeholder="搜索游戏名"
        placeholder-class="search__ph"
        @confirm="onSearchNow"
      />
      <text v-if="keyword" class="search__clear" @click="clearKeyword">✕</text>
    </view>

    <!-- 平台筛选：与首页同一套档位与视觉，数量为各平台收录的游戏款数 -->
    <view class="pfwrap">
      <PlatformFilter
        v-model:value="platform"
        :tabs="platTabs"
        title="按平台筛选"
        :hint="platHint"
        @change="reload"
      />
    </view>

    <!--
      🚨 筛选元数据（各平台款数 + 类型清单）加载失败时必须**明说**。
      2026-09-20 真机事故里，这块数据取回来后是「空的」，
      页面却只是安静地把「全部」渲染成 0、把类型条整行藏掉 —— 看起来像「库里本来就没游戏」，
      完全没有失败的样子，用户只能看出「统计不对」。宁可不显示数字，也不要显示假的 0。
    -->
    <view v-if="metaFailed" class="warn" @click="loadMeta">
      <text class="warn__text">⚠️ 平台 / 类型筛选数据加载失败，点此重试（不影响下面列表浏览）</text>
    </view>

    <!-- 类型筛选（30+ 种类型，按收录量倒序，横滑）。
      🚨 2026-09-20 去掉了行首的「全部类型」chip：上面平台档位里已经有「全部」，
         再来一个同义按钮纯属占位（用户反馈「实质并没有用处」）。
         清空类型的入口改为**再点一次已选中的类型**（选中态的角标从数量变成 ✕，给出可见提示）。
         类型清单为空时整行隐藏 —— 原来会渲染出一个只剩「全部类型」的孤零零空条。
    -->
    <scroll-view v-if="genres.length" scroll-x class="chips" :show-scrollbar="false">
      <view class="chips__inner">
        <view
          v-for="g in genres"
          :key="g.name"
          class="chip"
          :class="{ 'chip--on': genre === g.name }"
          @click="pickGenre(g.name)"
        >
          {{ g.name }}<text class="chip__n">{{ genre === g.name ? '✕' : g.count }}</text>
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
            <text v-if="g.platform" class="mp-tag mp-tag--purple">{{ platName(g.platform) }}</text>
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

      <view v-if="list.length" class="footer" @click="retryMore">{{ footerText }}</view>
    </template>
  </view>
</template>

<script setup>
/**
 * 游戏库 = 「多平台」这个定位的**第二入口**：
 * 首页按「文章」切平台，这里按「游戏」切平台 + 类型。
 *
 * 两处筛选的差别（容易混，写清楚）：
 *   · 这里的平台/类型筛选走**后端**（`/games?platform=&genre=`，接口原生支持）⇒ 真·服务端分页；
 *   · 首页的文章平台筛选只能走**端内索引**（`/posts` 没有 platform 参数）。
 *   数量都取自同一份游戏元数据缓存，口径一致。
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { onLoad, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { fetchGames } from '../../api/community'
import { PLATFORM_TABS, PLATFORM_HINT } from '../../api/config'
import { platformLabel } from '../../utils/format'
import { ensureGameMeta } from '../../utils/guideIndex'
import { usePagedList } from '../../utils/usePagedList'
import PlatformFilter from '../../components/PlatformFilter.vue'
import GameTile from '../../components/GameTile.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

const keyword = ref('')
const platform = ref('')
const genre = ref('')
const genres = ref([])
const platCount = ref({})
/** 元数据（平台档位数 + 类型清单）是否加载失败 —— 失败时页面必须明说，不能静默显示 0 */
const metaFailed = ref(false)

const platTabs = computed(() =>
  PLATFORM_TABS.map((t) => ({ ...t, count: platCount.value[t.value] }))
)
const platHint = computed(() =>
  platform.value ? PLATFORM_HINT[platform.value] || '' : '全部平台的游戏收录在一起'
)
const platName = (v) => platformLabel(v)

const { list, loading, failed, footerText, reload, loadMore, retryMore } = usePagedList(
  ({ current, size }) =>
    fetchGames({
      current,
      size,
      keyword: keyword.value || undefined,
      platform: platform.value || undefined,
      genre: genre.value || undefined
    }),
  { pageSize: 12, unit: '款' }
)

/* ==================== 搜索防抖 ====================
 * 原来只在「键盘回车」时才发请求，边打字边变（v-model 绑定）却不会刷新，
 * 用户容易以为搜索没生效。这里加 350ms 防抖：既实时又不至于每敲一个字打一次接口。
 */
let timer = null
watch(keyword, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => reload(), 350)
})
onUnmounted(() => {
  if (timer) clearTimeout(timer)
})

/** 键盘上的「搜索」键：立刻查，不等防抖 */
function onSearchNow() {
  if (timer) clearTimeout(timer)
  reload()
}

function clearKeyword() {
  keyword.value = ''
  if (timer) clearTimeout(timer)
  reload()
}

/**
 * 点类型 chip：选中 / **再点一次取消**（原来只能靠行首那个「全部类型」清空，
 * 而那个按钮在未选中时毫无作用，已被移除 —— 见模板注释）。
 */
function pickGenre(g) {
  const next = genre.value === g ? '' : g
  genre.value = next
  reload()
}

/**
 * 拉「全部游戏」的元数据：各平台收录款数（档位上的数字）+ 类型清单（chip 条）。
 * 与首页的端内索引共用同一份缓存（`utils/guideIndex.js#ensureGameMeta`）。
 *
 * 失败时**清空数字并置 metaFailed**（而不是留 0）—— 0 是会被当真的假数据。
 */
async function loadMeta() {
  metaFailed.value = false
  try {
    const meta = await ensureGameMeta()
    genres.value = meta.genres || []
    platCount.value = meta.platforms || {}
  } catch (e) {
    genres.value = []
    platCount.value = {}
    metaFailed.value = true
  }
}

onLoad(async () => {
  await loadMeta()
  reload()
})

onReachBottom(loadMore)

onPullDownRefresh(async () => {
  await reload()
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
  color: #8b8599;
}
.search__clear {
  font-size: 26rpx;
  color: #8b8599;
  padding-left: 16rpx;
}

.pfwrap {
  margin-top: 22rpx;
}

.chips {
  white-space: nowrap;
  width: 100%;
  margin: 0 0 24rpx;
}
.chips__inner {
  display: inline-flex;
}
.chip {
  flex: none;
  padding: 10rpx 26rpx;
  border-radius: 30rpx;
  background: #231f31;
  font-size: 24rpx;
  color: #c8c3d6;
  border: 1rpx solid transparent;
  margin-right: 14rpx;
}
.chip--on {
  background: rgba(124, 92, 255, 0.2);
  border-color: #7c5cff;
  color: #cbbdff;
}
.chip__n {
  font-size: 20rpx;
  color: #8b8599;
  margin-left: 6rpx;
}
.chip--on .chip__n {
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
  color: #a49eb6;
}
.gitem__tags {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  overflow: hidden;
  margin-top: 14rpx;
}
/* uni-text 默认 white-space: pre-line，不显式置回 nowrap 会被拆行 */
.gitem__tags > * {
  white-space: nowrap;
}
.gitem__tags .mp-tag {
  margin-right: 12rpx;
}
.gitem__count {
  font-size: 22rpx;
  color: #8b8599;
  margin-left: auto;
}

.footer {
  text-align: center;
  font-size: 23rpx;
  color: #8b8599;
  padding: 24rpx 0 10rpx;
}

/* 元数据加载失败提示 —— 语气克制，明确「不影响列表」 */
.warn {
  margin: 0 0 18rpx;
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
</style>

<template>
  <view class="mp-page">
    <!-- 关键词搜索（带防抖，见 script）。可搜游戏名，也可搜**类型名**（如 MMORPG / RPG / 策略）。 -->
    <view class="search">
      <text class="search__icon">🔍</text>
      <input
        class="search__input"
        v-model="keyword"
        type="text"
        confirm-type="search"
        placeholder="搜索游戏名或类型"
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
      🚨 元数据（各平台款数 + 类型清单）加载失败时必须**明说**。
      2026-09-20 真机事故里，这块数据取回来后是「空的」，
      页面却只是安静地把「全部」渲染成 0 —— 看起来像「库里本来就没游戏」，
      完全没有失败的样子，用户只能看出「统计不对」。宁可不显示数字，也不要显示假的 0。
    -->
    <view v-if="metaFailed" class="warn" @click="loadMeta">
      <text class="warn__text">⚠️ 平台统计加载失败，点此重试（不影响下面列表浏览）</text>
    </view>

    <!--
      🚨 2026-09-20 移除「类型」二次分类筛选行（用户反馈：不必显示这些标签、也不必用标签二次分类）。
         类型不再当筛选器，改为**搜索即达**：在上面的搜索框输入类型名（MMORPG / RPG / 策略…），
         端内把它解析成 genre 走 `/games?genre=` 精确筛选。
         为什么必须端内转换：后端 `/games` 的 `keyword` 只 like 名称/简介，**不匹配 genre**。
    -->

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
 * 首页按「文章」切平台，这里按「游戏」切平台；**类型（标签）不再做二次分类筛选**，
 * 改为「搜索即达」—— 输入类型名（MMORPG / RPG / 策略…）由端内解析成 genre（见下方 genreHit）。
 *
 * 两处筛选的差别（容易混，写清楚）：
 *   · 这里的平台筛选走**后端**（`/games?platform=`）⇒ 真·服务端分页；
 *     类型名搜索最终也落到后端的 `genre=` 精确筛选；
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

/**
 * 类型（标签）只作为**搜索词**：输入类型名（MMORPG / RPG / 策略…）时，
 * 端内解析成对应的 genre，改走后端 `/games?genre=` 精确筛选。
 *
 * 为什么必须端内转换：后端 `/games` 的 `keyword` 只 `like(name/description)`，
 * **不匹配 genre**（`/search?type=game` 会匹配 genre，但它不分页、也丢了平台筛选）。
 * 2026-09-20 去掉类型筛选行后，类型改为「搜索即达」，靠这里补上。
 *
 * 匹配优先级：完全相等 → 前缀（≥2 字）→ 包含（≥2 字），均不区分大小写。
 * 单字只认「完全相等」，避免输入「a」时把所有 ACT / AVG / MMO… 一起捞出来。
 */
const genreHit = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw || !genres.value.length) return ''
  const names = genres.value.map((g) => g.name)
  const exact = names.find((n) => n.toLowerCase() === kw)
  if (exact) return exact
  if (kw.length >= 2) {
    const pre = names.find((n) => n.toLowerCase().startsWith(kw))
    if (pre) return pre
    const inc = names.find((n) => n.toLowerCase().includes(kw))
    if (inc) return inc
  }
  return ''
})

const { list, loading, failed, footerText, reload, loadMore, retryMore } = usePagedList(
  ({ current, size }) => {
    // 命中类型名时改走 genre 精确筛选（此时不再传 keyword，避免被 name/description 的 like 反抢）
    const hit = genreHit.value
    return fetchGames({
      current,
      size,
      keyword: hit ? undefined : keyword.value || undefined,
      platform: platform.value || undefined,
      genre: hit || undefined
    })
  },
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
 * 拉「全部游戏」的元数据：各平台收录款数（档位上的数字）+ 类型清单（供搜索把类型名解析成 genre）。
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

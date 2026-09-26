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
      🚨 元数据（各平台款数 + 类型清单）与**帖数**加载失败时必须**明说**。
      2026-09-20 真机事故里，这块数据取回来后是「空的」，
      页面却只是安静地把「全部」渲染成 0 —— 看起来像「库里本来就没游戏」，
      完全没有失败的样子，用户只能看出「统计不对」。宁可不显示数字，也不要显示假的 0。
      （帖数是 2026-09-26 加进来的第二类统计，同一条纪律：取不到就整块不显示。）
    -->
    <view v-if="statFailed" class="warn" @click="retryStats">
      <text class="warn__text">{{ warnText }}</text>
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
            <!--
              🚨 帖数**必须**用端内索引算出来的「攻略 + 资讯」数，不能用 `g.postCount`：
                 `game.post_count` 是**主站口径**（该游戏在全部 6 个板块的帖子），
                 而本端只展示攻略心得(board 1) + 资讯速递(board 4)。
                 用错就会出现「卡片写着 1 帖、点进去两个 Tab 都空」——
                 2026-09-26 用户实报的「白夜极光」就是：那唯一 1 帖发在 board 2「游戏吐槽」。
                 线上 81 款里 63 款都对不上（全部虚高）。
              `gameCounts === null` = 索引还没同步好 ⇒ **不渲染数字**，绝不显示假 0
              （同 `metaFailed` 的纪律：宁可不显示，也不要显示错的）。
            -->
            <text v-if="gameCounts" class="gitem__count">
              <text class="mp-num">{{ gameCounts[g.id] || 0 }}</text> 帖
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
 *   平台档位的「款数」取自同一份游戏元数据缓存，口径一致；
 *   卡片上的「N 帖」则取自**端内索引**（= 攻略 + 资讯，见 `gameCounts` 注释）。
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { onLoad, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { fetchGames } from '../../api/community'
import { PLATFORM_TABS, PLATFORM_HINT } from '../../api/config'
import { platformLabel } from '../../utils/format'
import { ensureGameMeta, ensureIndex, countByGame } from '../../utils/guideIndex'
import { matchGenre } from '../../utils/keywordFilter'
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

/**
 * `gameId → 该游戏的「攻略 + 资讯」帖数`（卡片右下角那个数字）。
 *
 * 🚨 **不要换回 `g.postCount`**：那是主站口径 —— `game.post_count` 数的是该游戏在
 *   **全部 6 个板块**的可见帖，而本端只聚合攻略心得(board 1) + 资讯速递(board 4)。
 *   2026-09-26 用户实报：「白夜极光」卡片写 1 帖，点进去两个 Tab 都空 ——
 *   那唯一 1 帖其实发在 board 2「游戏吐槽」。线上 81 款里 **63 款**对不上（全部虚高）。
 *
 * 数字由**端内索引**（`ensureIndex`，内容池 = `GUIDE_BOARDS` = board 1 + 4）逐条累计得到，
 * 所以「卡片上写几」与「点进去能看几」在**构造上**就是同一个集合，不可能再漂移 ——
 * 口径的唯一真源是 `api/config.js#GUIDE_BOARDS`，将来增减板块两边一起变。
 *
 * `null` = 索引尚未同步好 ⇒ **不渲染数字**，绝不显示假 0。
 */
const gameCounts = ref(null)
/** 端内索引同步失败（帖数取不到）—— 与 metaFailed 同一条纪律：必须明说 */
const countFailed = ref(false)

const statFailed = computed(() => metaFailed.value || countFailed.value)
const warnText = computed(() => {
  const what =
    metaFailed.value && countFailed.value ? '平台统计与帖子数' : countFailed.value ? '帖子数' : '平台统计'
  return `⚠️ ${what}加载失败，点此重试（不影响下面列表浏览）`
})

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
 * 解析规则（完全相等 → 前缀 ≥2 字 → 包含 ≥2 字；单字只认完全相等）已抽到
 * `utils/keywordFilter.js`，与**搜索页**共用同一份 —— 两处若各写一份，
 * 迟早漂移成「同一个词在游戏库能搜到、在搜索页搜不到」（2026-09-21 那次
 * 「搜『资讯』搜出仙剑」正是这种口径不一致的产物）。
 */
const genreHit = computed(() => matchGenre(keyword.value, genres.value))

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
 * 帖数（`ensureIndex`）同理，失败置 `gameCounts = null` 并置 `countFailed`。
 */
async function loadMeta({ force = false } = {}) {
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

  /**
   * 帖数同样来自端内索引（与首页共用同一份缓存，命中时零请求）。
   * 失败时置 `null` —— **整块不显示数字**，而不是显示 0（假 0 比不显示更坏）。
   */
  countFailed.value = false
  try {
    const { items } = await ensureIndex({ force })
    gameCounts.value = countByGame(items)
  } catch (e) {
    gameCounts.value = null
    countFailed.value = true
  }
}

/** 提示条的「点此重试」：强制重新同步（别拿过期缓存糊弄一次显式点击） */
function retryStats() {
  loadMeta({ force: true })
}

onLoad(() => {
  // 列表先走（1 个请求），统计数字在后台补齐 —— 数字不该阻塞首屏内容。
  // （串在前面会让冷启动多等约 5 个请求；首页默认就会同步索引，正常路径下这里几乎瞬时。）
  reload()
  loadMeta()
})

onReachBottom(loadMore)

onPullDownRefresh(async () => {
  // 下拉是用户**明确要求刷新** ⇒ 统计也强制重算，否则帖数要等 TTL(10min) 才更新
  await Promise.all([reload(), loadMeta({ force: true })])
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
/* uni-text 默认 white-space: pre-line，不显式置回 nowrap 会被拆行。
   ⚠️ `*` 只有 H5 认，微信 WXSS 不支持通配符（wcsc 报 error at token '*' ⇒ 小程序编译失败），
   故用条件编译只给 H5。别去掉 #ifdef。 */
/* #ifdef H5 */
.gitem__tags > * {
  white-space: nowrap;
}
/* #endif */
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

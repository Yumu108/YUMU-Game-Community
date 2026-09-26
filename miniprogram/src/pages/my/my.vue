<template>
  <view class="mp-page">
    <!--
      账号区：账号与主站通用（2026-09-17 接入登录）。
      🚨 2026-09-21 口径变更：游客（未登录）**只能看浏览记录** ——
        收藏 / 点赞 / 举报都需要登录。所以这里的副标题要**如实说明差在哪**，
        而不是像旧版那样写「收藏、点赞与浏览记录都保存在本机」（那已经是错的：
        收藏/点赞既不本机、也不对游客开放）。
    -->
    <view class="user">
      <view class="user__avatar">{{ avatarLetter }}</view>
      <view class="user__info">
        <!--
          名字 + 角色徽章同一行（2026-09-26 新增）。
          文案与配色**全部来自后端**（`badgeText` / `badgeColor`，见 `BadgeService#compute`），
          前端只在字段缺失时按 roles 兜底 —— 后端以后加新角色（如「超级版主」）前端不用改。
          普通用户 badge 恒为 null ⇒ `badge.text` 为空 ⇒ 整块不渲染，不留空壳。
        -->
        <view class="user__namerow">
          <text class="user__name mp-ellipsis">{{ logged ? user.nickname || user.username : '访客模式' }}</text>
          <text
            v-if="logged && badge.text"
            class="user__badge"
            :class="'user__badge--' + badge.color"
          >{{ badge.text }}</text>
        </view>
        <text class="user__tip">
          {{ logged ? '已登录（账号与主站通用）' : '游客只能查看浏览记录；收藏 / 点赞 / 举报需先登录' }}
        </text>
      </view>
      <text v-if="!logged" class="user__login" @click="goLogin">登录 / 注册</text>
      <text v-else class="user__login user__login--out" @click="onLogout">退出</text>
    </view>

    <!--
      我的权限（2026-09-26 新增，同日增强）—— 作业要求 D 里「权限方案」在小程序端的**可见载体**。
      🚨 数据全部来自后端（登录响应与 `GET /auth/me` 的 `UserInfoVO`），端内**不做任何权限推理**：
        `roles` → 角色、`badgeText`/`badgeColor` → 徽章、
        `moderatorGameNames`/`moderatorGameIds` → 负责范围（游戏级授权）。
        要加展示项，先确认后端 VO 真有那个字段，别在前端自己拼结论。
      ⚠️ 这张卡是「说明我有什么权限」，不是「我能不能做」的判据 ——
        真正的判定在后端（`@PreAuthorize` / `canModeratePost`），端内只在详情页按角色决定显示什么。
    -->
    <view v-if="logged" class="perm">
      <view class="perm__head">
        <text class="perm__title">我的权限</text>
        <text class="perm__role" :class="'perm__role--' + perm.color">{{ perm.label }}</text>
      </view>

      <!--
        管辖范围（2026-09-26 增强）—— ADMIN 与 MODERATOR 差异**最直观**的一处：
          管理员 = 全站所有游戏；版主 = 只有自己负责的那**一个**游戏
          （后端 `ModeratorBoardServiceImpl#MAX_GAMES_PER_MOD = 1`）。
        🚨 取值必须用 `moderatorGameNames`（游戏级授权），不是 `moderatorBoardNames` ——
          后者在现行授权模型下恒为空，会把版主显示成「暂未分配负责范围」。
      -->
      <view class="scope" :class="'scope--' + perm.color">
        <text class="scope__label">管辖范围</text>
        <text class="scope__val">{{ perm.scopeShort }}</text>
        <text class="scope__full">{{ perm.scope }}</text>
      </view>

      <view v-for="(c, i) in perm.can" :key="i" class="perm__row">
        <text class="perm__dot">·</text>
        <text class="perm__txt">{{ c }}</text>
      </view>

      <!--
        权限矩阵（2026-09-26 新增）—— 「权限方案」最标准的呈现方式：把后端每一项权力摊平，
        逐条标出**当前角色能不能用**。`✓` 可用 / `⊘` 无权限（灰显 + 标注「仅管理员」）。
        🚨 表里的接口路径是后端**真实存在**的，单测会读 `AdminController.java` 源码核对
          （`tests/roles.test.mjs` F 组）—— 别在这里写不存在的接口，一写就红。
      -->
      <view v-if="matrix.length" class="mx">
        <view class="mx__head">
          <text class="mx__title">权限矩阵</text>
          <text class="mx__count">可执行 {{ capStats.allowed }} / {{ capStats.total }} 项</text>
        </view>
        <view
          v-for="c in matrix"
          :key="c.key"
          class="mx__row"
          :class="{ 'mx__row--off': !c.allowed }"
        >
          <text class="mx__mark" :class="c.allowed ? 'mx__mark--on' : 'mx__mark--off'">
            {{ c.allowed ? '✓' : '⊘' }}
          </text>
          <view class="mx__body">
            <text class="mx__name">{{ c.name }}</text>
            <text class="mx__tag">{{ capTag(c) }}</text>
          </view>
        </view>
        <text class="mx__note">
          逐条对应后端真实接口（形如 POST /admin/posts/{id}/pin）。「限管辖范围」= 版主只能操作自己负责游戏下的内容；「主站操作」= 该项只在主站管理后台提供，端内未接按钮。
        </text>
      </view>

      <view v-if="canManageEntry" class="perm__hint">
        <text class="perm__hint-txt">
          帖子详情页会出现「管理」入口（{{ manageHint }}）——只有你负责的范围才会真正放行。
        </text>
      </view>
      <text class="perm__note">
        权限由后端 RBAC 判定（role / user_role / moderator_board 三张表 + 接口上的 @PreAuthorize）；端内只按角色决定显示什么。
      </text>
    </view>

    <!--
      AI 智能助手入口（2026-09-26 新增）：复用后端现成 `POST /api/ai/chat`，无后端改动。
      放在账号卡下方、Tab 上方，游客和登录用户都能用（AI 接口本身不强制登录）。
    -->
    <view class="ai-entry" @click="goAi">
      <text class="ai-entry__icon">✨</text>
      <view class="ai-entry__body">
        <text class="ai-entry__title">AI 智能助手</text>
        <text class="ai-entry__sub">问社区玩法 · 推荐攻略与游戏</text>
      </view>
      <text class="ai-entry__arrow">›</text>
    </view>

    <!-- Tab：游客只有一个（历史），登录后才有收藏 / 点赞 -->
    <view class="tabs">
      <view
        v-for="t in tabs"
        :key="t.key"
        class="tabs__item"
        :class="{ 'tabs__item--on': tab === t.key }"
        @click="tab = t.key"
      >
        {{ t.label }}
      </view>
    </view>

    <!--
      同步提示：收藏 / 点赞来自端内索引（服务端数据）。
      `stale` = 本次同步失败但用上了上一次的内容 —— 必须说出来，
      否则用户会把「看到的旧列表」当成当前事实（本项目反复踩的那类坑）。
    -->
    <view v-if="stale && tab !== 'his'" class="hint">
      <text class="hint__text">⚠️ 网络异常，以下为上一次同步的内容，可能不是最新</text>
    </view>

    <!-- 内容：本地历史与本服务端列表共用一套渲染 -->
    <Skeleton v-if="loading" :rows="3" />

    <ErrorState
      v-else-if="failed"
      icon="📡"
      text="列表加载失败"
      :sub="errMsg"
      @retry="loadServerLists"
    />

    <template v-else-if="current.length">
      <view v-for="it in current" :key="it.id" class="item" @click="goItem(it)">
        <view class="item__body">
          <text class="item__title mp-ellipsis">{{ it.title }}</text>
          <view class="item__meta">
            <text v-if="it.gameName" class="mp-tag mp-tag--purple">{{ it.gameName }}</text>
            <text v-if="it.boardName" class="item__board">{{ it.boardName }}</text>
            <text class="item__time">{{ timeOf(it.at || it.createdAt) }}</text>
          </view>
        </view>
        <text class="item__arrow">›</text>
      </view>

      <!-- 清空只对「浏览记录」有意义：收藏/点赞在服务端，逐条取消才是正确做法 -->
      <view v-if="tab === 'his'" class="danger" @click="onClear">清空浏览记录</view>
    </template>

    <EmptyState v-else :icon="emptyIcon" :text="emptyText" :sub="emptySub" />

    <!-- 说明 -->
    <view class="about">
      <text class="about__title">关于</text>
      <text class="about__text">
        YUMU 攻略库 · 内容来自 YUMU 游戏社区。本端做多平台攻略与资讯的聚合和分类展示，
        不含发帖、回复、私信等社交功能。
      </text>
      <text class="about__text about__text--mt">
        {{ logged
          ? '收藏与点赞保存在账号里（服务端），换设备登录同一账号即可看到；浏览历史保存在本机。'
          : '浏览历史保存在本机（换设备不会同步）；收藏、点赞、举报需要登录后才能使用。' }}
      </text>
    </view>
  </view>
</template>

<script setup>
/**
 * 「我的」= 收藏 / 点赞（**服务端**，需登录）+ 浏览历史（**本机**，游客也可用）。
 *
 * 🚨 2026-09-21 口径变更（重要）：
 *   · 游客（未登录）**只展示「浏览记录」**这一个 Tab —— 收藏与点赞都需要登录，
 *     对一个没登录的人展示空列表毫无意义，还会让人以为是数据丢了；
 *   · 登录后收藏 / 点赞的**数据源是服务端**：端内索引的记录带 `liked` / `favorited`
 *     （后端在带 token 的列表请求里下发），这里只是筛一遍 —— **0 额外请求**。
 *   · 所以本页依赖索引缓存，**登录 / 退出时必须让缓存失效**
 *     （`clearIndexCache()`，登录页与下面的退出流程各调一次），否则会显示上一个身份的数据。
 *
 * 定位仍是「弱化互动的展示端」：这里没有任何社交入口（关注、粉丝、私信一律没有）。
 */
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getHistory, clearHistory, getUser, clearUser, patchIdentity } from '../../utils/store'
import { logout, fetchMe } from '../../api/auth'
import { clearSession } from '../../api/request'
import { ensureIndex, clearIndexCache } from '../../utils/guideIndex'
import { formatTime } from '../../utils/format'
import { permissionSummary, badgeMeta, canSeeManageEntry, actionsFor, capabilityMatrix } from '../../utils/roles'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

const tab = ref('his')
const favorites = ref([])
const likes = ref([])
const history = ref([])
const user = ref(null)
const logged = ref(false)

/** 收藏 / 点赞来自索引 ⇒ 有加载态与失败态；历史是本机数据，不会失败 */
const loading = ref(false)
const failed = ref(false)
const errMsg = ref('')
const stale = ref(false)

/* ==================== 角色 / 权限（2026-09-26 新增） ====================
 * 数据来源：登录响应与 `GET /auth/me` 的 `UserInfoVO`（由 `utils/store.js` 存取）。
 * 判断逻辑全在 `utils/roles.js`（零依赖纯函数、有单测），本页只负责渲染。
 */

/**
 * ⚠️ 必须是 computed，不能在 onShow 里存一份普通变量：
 *    `syncMe()` 是**异步**回填角色的，存普通变量会出现
 *    「刚进页面没徽章、退出去再进才有」这种时序 bug。
 */
const badge = computed(() => badgeMeta(user.value || {}))
const perm = computed(() => permissionSummary(user.value || {}))
const canManageEntry = computed(() => canSeeManageEntry((user.value && user.value.roles) || []))
/** 管理入口大致能给哪些动作（与详情页共用同一份 actionsFor，避免两处文案各说各话） */
const manageHint = computed(() =>
  actionsFor((user.value && user.value.roles) || [], { nonPublic: false })
    .map((a) => a.short)
    .join(' / ')
)

/**
 * 权限矩阵：把后端每一项能力摊平，逐条标「当前角色能不能用」。
 *
 * ⚠️ 只有 ADMIN / MODERATOR 才渲染 —— 普通用户看一张 11 行全是 ⊘ 的表没有意义
 *    （`capabilityStats` 也能算出 0/11，但那是噪音不是信息）。
 */
const matrix = computed(() => {
  const roles = (user.value && user.value.roles) || []
  return canSeeManageEntry(roles) ? capabilityMatrix(roles) : []
})

/** 「可执行 N / M 项」计数 —— 管理员 11 项 vs 版主 5 项，这个数字本身就是差异的直接表达 */
const capStats = computed(() => {
  const list = matrix.value
  return { total: list.length, allowed: list.filter((c) => c.allowed).length }
})

/**
 * 给矩阵每行拼一句说明。
 * 三个维度都要说清：**能否用**（allowed）、**范围**（scoped）、**在哪操作**（mp）。
 * 「主站操作」如实标注比假装端内都有更经得起追问 —— 举报列表、用户管理这些
 * 重后台操作本来就该在主站做。
 */
function capTag(c) {
  if (!c.allowed) return '仅管理员可执行'
  const scopeTxt = c.scoped ? '限管辖范围' : '全站生效'
  return `${scopeTxt} · ${c.mp ? '端内可操作' : '主站操作'}`
}

/**
 * 静默校正登录态 —— 主要用途是**给旧登录态补角色字段**。
 *
 * 为什么需要：本次改动之前登录的用户，storage 里没有 roles（那时 `setUser` 还没存），
 * 只靠登录响应补不上。进这个页时问一次 `/auth/me` 并合并回去，老会话也能显示徽章。
 *
 * 🚨 三条约束：
 *  ① `{ silent: true }` —— 这是「允许失败的后台校正」，失败绝不能弹错；
 *  ② 用 `patchIdentity`（**合并**）而非 `setUser`（整体覆盖）—— 后者只要有一次响应缺字段
 *     就会把已有身份抹平；
 *  ③ 不 await 进 onShow 主流程（别拖慢列表加载），失败静默忽略。
 */
async function syncMe() {
  if (!logged.value) return
  try {
    const me = await fetchMe({ silent: true })
    if (!me || !me.id) return
    const cur = getUser()
    // 同一账号才合并；id 不同说明 storage 被外部改过，交给登录流程去纠正
    if (cur && cur.id !== me.id) return
    patchIdentity(me)
    user.value = getUser()
  } catch (e) {
    /* 静默：校正失败不影响页面 —— 列表该显示什么还是什么 */
  }
}

const avatarLetter = computed(() => {
  const u = user.value
  if (!u) return '游'
  return (u.nickname || u.username || '游').slice(0, 1)
})

/**
 * Tab 列表按登录态生成 —— 游客**只给历史**。
 * 这样游客既看不到空列表，也不需要「点了再告诉你先登录」这种绕路。
 */
const tabs = computed(() =>
  logged.value
    ? [
        { key: 'fav', label: `收藏 ${favorites.value.length}` },
        { key: 'like', label: `点赞 ${likes.value.length}` },
        { key: 'his', label: `历史 ${history.value.length}` }
      ]
    : [{ key: 'his', label: `历史 ${history.value.length}` }]
)

const current = computed(() =>
  tab.value === 'fav' ? favorites.value : tab.value === 'like' ? likes.value : history.value
)
const emptyIcon = computed(() => (tab.value === 'fav' ? '★' : tab.value === 'like' ? '👍' : '🕘'))
const emptyText = computed(() =>
  tab.value === 'fav'
    ? '还没有收藏内容'
    : tab.value === 'like'
      ? '还没有点赞内容'
      : logged.value
        ? '还没有浏览记录'
        : '登录后才有收藏与点赞'
)
const emptySub = computed(() =>
  tab.value === 'his' ? '去攻略库逛逛，看过的帖子会自动记在这里' : '在帖子详情页底部可以收藏 / 点赞'
)

const timeOf = (v) => formatTime(v)

/** 取服务端列表（= 端内索引里带 liked / favorited 的记录） */
async function loadServerLists() {
  if (!logged.value) {
    favorites.value = []
    likes.value = []
    loading.value = false
    failed.value = false
    stale.value = false
    return
  }
  loading.value = true
  failed.value = false
  try {
    const res = await ensureIndex({})
    const items = res.items || []
    favorites.value = items.filter((it) => it.favorited === true)
    likes.value = items.filter((it) => it.liked === true)
    stale.value = res.stale === true
  } catch (e) {
    failed.value = true
    errMsg.value = (e && e.message) || '请稍后重试'
    favorites.value = []
    likes.value = []
  } finally {
    loading.value = false
  }
}

/** onShow：从详情页返回后要能看到刚收藏 / 刚点赞 / 刚浏览的内容；登录态也在这里刷新 */
onShow(() => {
  user.value = getUser()
  logged.value = !!user.value
  // 退出登录后若停在收藏/点赞 Tab 上，会看到「游客却在看收藏」的错位
  if (!logged.value && tab.value !== 'his') tab.value = 'his'
  history.value = getHistory()
  // 角色是异步回填的（旧会话 storage 里没有 roles）⇒ 先渲染、后台补，不阻塞列表
  syncMe()
  loadServerLists()
})

function goLogin() {
  uni.navigateTo({ url: '/pages/login/login' })
}

/** 进入 AI 智能助手页（独立页面，复用后端 SSE 接口） */
function goAi() {
  uni.navigateTo({ url: '/pages/ai/ai' })
}

/**
 * 退出登录：先尽力通知后端把 token 入黑名单，**无论成败都清本地会话**。
 * （后端 /auth/logout 对已过期 token 也是 no-op，语义上就是「清残留」。）
 *
 * 🚨 必须同时 `clearIndexCache()`：索引里存着这个账号的 `liked` / `favorited`，
 *   不清的话退登后「我的」页仍会显示**上一个账号的**收藏与点赞。
 *   本地浏览历史**保留** —— 它不绑账号，是这台设备的记录。
 */
function onLogout() {
  uni.showModal({
    title: '退出登录',
    content: '收藏与点赞保存在账号里，退出后本机不再展示；浏览记录会保留在本机。',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await logout()
      } catch (e) {
        /* 后端失败不阻断 —— 本地必须清干净 */
      }
      clearSession()
      clearUser()
      clearIndexCache()
      user.value = null
      logged.value = false
      tab.value = 'his'
      favorites.value = []
      likes.value = []
      uni.showToast({ title: '已退出登录', icon: 'none' })
    }
  })
}

function goItem(it) {
  uni.navigateTo({ url: `/pages/post/detail?id=${it.id}` })
}

function onClear() {
  uni.showModal({
    title: '确认清空',
    content: '将删除全部本机浏览记录，确定吗？',
    success: (res) => {
      if (!res.confirm) return
      clearHistory()
      history.value = getHistory()
      uni.showToast({ title: '已清空', icon: 'none' })
    }
  })
}
</script>

<style scoped>
.user {
  display: flex;
  align-items: center;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 24rpx;
  padding: 28rpx;
}
.user__avatar {
  width: 92rpx;
  height: 92rpx;
  border-radius: 50%;
  background: #3a3350;
  color: #cbbdff;
  font-size: 34rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.user__login {
  margin-left: auto;
  flex-shrink: 0;
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  background: #7c5cff;
  color: #fff;
  font-size: 24rpx;
  font-weight: 600;
}
.user__login--out {
  background: transparent;
  border: 1rpx solid #3a3350;
  color: #a49eb6;
  font-weight: 400;
}
.user__info {
  flex: 1;
  min-width: 0;
  margin-left: 22rpx;
}
/* 名字 + 角色徽章一行：名字可截断，徽章固定不缩（flex: none） */
.user__namerow {
  display: flex;
  align-items: center;
  min-width: 0;
}
.user__name {
  display: block;
  min-width: 0;
  font-size: 32rpx;
  font-weight: 600;
  color: #e9e7f2;
}
/* 角色徽章 —— 配色沿用**后端词表**（danger=管理员 / warning=版主，见 BadgeService#compute） */
.user__badge {
  flex: none;
  margin-left: 14rpx;
  font-size: 20rpx;
  line-height: 1.75;
  padding: 0 12rpx;
  border-radius: 6rpx;
}
.user__badge--danger {
  background: rgba(240, 90, 90, 0.18);
  color: #ff9a9a;
}
.user__badge--warning {
  background: rgba(240, 159, 39, 0.18);
  color: #f0b45f;
}
.user__tip {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #8b8599;
}

/* ==================== 我的权限卡 ==================== */
.perm {
  margin-top: 20rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background: #1a1725;
  border: 1rpx solid #2a2538;
}
.perm__head {
  display: flex;
  align-items: center;
  margin-bottom: 10rpx;
}
.perm__title {
  font-size: 27rpx;
  font-weight: 600;
  color: #e9e7f2;
}
.perm__role {
  flex: none;
  margin-left: 14rpx;
  font-size: 20rpx;
  line-height: 1.75;
  padding: 0 12rpx;
  border-radius: 6rpx;
}
.perm__role--danger {
  background: rgba(240, 90, 90, 0.18);
  color: #ff9a9a;
}
.perm__role--warning {
  background: rgba(240, 159, 39, 0.18);
  color: #f0b45f;
}
.perm__role--default {
  background: rgba(124, 92, 255, 0.16);
  color: #cbbdff;
}
/*
  管辖范围块（2026-09-26 增强）—— 管理员「全站」vs 版主「仅限《XX》」，
  两个账号并排看，差异一目了然。配色沿用徽章那套词（后端 BadgeService 口径）。
  ⚠️ 这里已取代原来的单行 `.perm__scope`（那个太容易被当成一行普通说明略过）。
*/
.scope {
  margin: 4rpx 0 16rpx;
  padding: 16rpx 20rpx;
  border-radius: 14rpx;
  background: #201c2e;
  border: 1rpx solid #2c2740;
}
.scope__label {
  display: block;
  font-size: 20rpx;
  color: #8b8599;
}
.scope__val {
  display: block;
  margin-top: 6rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: #e9e7f2;
}
.scope__full {
  display: block;
  margin-top: 6rpx;
  font-size: 21rpx;
  color: #8b8599;
}
.scope--danger {
  border-color: rgba(240, 90, 90, 0.35);
}
.scope--danger .scope__val {
  color: #ff9a9a;
}
.scope--warning {
  border-color: rgba(240, 159, 39, 0.35);
}
.scope--warning .scope__val {
  color: #f0b45f;
}

/* ==================== 权限矩阵（✓ 可用 / ⊘ 仅管理员） ==================== */
.mx {
  margin-top: 18rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid #2a2538;
}
.mx__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12rpx;
}
.mx__title {
  font-size: 25rpx;
  font-weight: 600;
  color: #e9e7f2;
}
.mx__count {
  flex: none;
  font-size: 21rpx;
  color: #cbbdff;
}
.mx__row {
  display: flex;
  align-items: flex-start;
  padding: 10rpx 0;
}
/* 无权限的项整体降透明度 —— 与绿色 ✓ 形成对比，扫一眼就知道哪些做不了 */
.mx__row--off {
  opacity: 0.45;
}
.mx__mark {
  flex: none;
  width: 34rpx;
  font-size: 24rpx;
  line-height: 1.5;
}
.mx__mark--on {
  color: #5dcaa5;
}
.mx__mark--off {
  color: #6f6982;
}
.mx__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.mx__name {
  font-size: 23rpx;
  color: #d9d6e6;
}
.mx__tag {
  margin-top: 2rpx;
  font-size: 19rpx;
  color: #6f6982;
}
.mx__note {
  display: block;
  margin-top: 12rpx;
  font-size: 19rpx;
  line-height: 1.65;
  color: #6f6982;
}
.perm__row {
  display: flex;
  align-items: flex-start;
  margin-bottom: 8rpx;
}
.perm__dot {
  flex: none;
  margin-right: 10rpx;
  font-size: 23rpx;
  color: #7c5cff;
}
.perm__txt {
  flex: 1;
  min-width: 0;
  font-size: 23rpx;
  color: #9c96ad;
  line-height: 1.6;
}
.perm__hint {
  margin-top: 16rpx;
  padding: 14rpx 18rpx;
  border-radius: 14rpx;
  background: rgba(124, 92, 255, 0.1);
  border: 1rpx solid rgba(124, 92, 255, 0.28);
}
.perm__hint-txt {
  font-size: 21rpx;
  color: #cbbdff;
  line-height: 1.6;
}
.perm__note {
  display: block;
  margin-top: 16rpx;
  font-size: 20rpx;
  color: #6f6982;
  line-height: 1.6;
}

/* 同步提示（stale）—— 与普通说明区分开，别让它淹没在灰字里 */
.hint {
  padding: 14rpx 18rpx;
  margin-bottom: 16rpx;
  background: rgba(255, 176, 32, 0.1);
  border: 1rpx solid rgba(255, 176, 32, 0.32);
  border-radius: 14rpx;
}
.hint__text {
  font-size: 21rpx;
  color: #ffce7a;
  line-height: 1.6;
}

.tabs {
  display: flex;
  margin: 26rpx 0 22rpx;
  background: #231f31;
  border-radius: 16rpx;
  padding: 6rpx;
}
.tabs__item {
  flex: 1;
  text-align: center;
  font-size: 25rpx;
  color: #a49eb6;
  padding: 14rpx 0;
  border-radius: 12rpx;
}
.tabs__item--on {
  background: rgba(124, 92, 255, 0.22);
  color: #cbbdff;
  font-weight: 600;
}

.item {
  display: flex;
  align-items: center;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 20rpx;
  padding: 22rpx;
  margin-bottom: 14rpx;
}
.item__body {
  flex: 1;
  min-width: 0;
}
.item__title {
  display: block;
  font-size: 28rpx;
  color: #e9e7f2;
}
.item__meta {
  display: flex;
  align-items: center;
  margin-top: 10rpx;
}
/* uni-text 自带 white-space: pre-line，不逐个命中会被长游戏名拆行。
   ⚠️ `*` 只有 H5 认，微信 WXSS 不支持通配符（wcsc 报 error at token '*' ⇒ 小程序编译失败），
   故用条件编译只给 H5。别去掉 #ifdef。 */
/* #ifdef H5 */
.item__meta > * {
  white-space: nowrap;
}
/* #endif */
.item__board {
  font-size: 22rpx;
  color: #8b8599;
  margin-left: 12rpx;
}
.item__time {
  font-size: 22rpx;
  color: #8b8599;
  margin-left: auto;
}
.item__arrow {
  font-size: 30rpx;
  color: #8b8599;
  margin-left: 14rpx;
}

.danger {
  text-align: center;
  font-size: 25rpx;
  color: #f0b45f;
  padding: 24rpx 0;
}

/* AI 智能助手入口卡片 */
.ai-entry {
  display: flex;
  align-items: center;
  background: linear-gradient(135deg, #221d33, #1a1725);
  border: 1rpx solid #332c4a;
  border-radius: 20rpx;
  padding: 22rpx 24rpx;
  margin-bottom: 20rpx;
}
.ai-entry__icon {
  font-size: 34rpx;
  margin-right: 18rpx;
  flex: none;
}
.ai-entry__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.ai-entry__title {
  font-size: 28rpx;
  color: #e9e7f2;
  font-weight: 600;
}
.ai-entry__sub {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #8b8599;
}
.ai-entry__arrow {
  font-size: 30rpx;
  color: #8b8599;
  margin-left: 14rpx;
  flex: none;
}

.about {
  margin-top: 40rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background: #1a1725;
  border: 1rpx solid #2a2538;
}
.about__title {
  display: block;
  font-size: 25rpx;
  color: #a49eb6;
  margin-bottom: 10rpx;
}
.about__text {
  font-size: 23rpx;
  color: #8b8599;
  line-height: 1.7;
}
.about__text--mt {
  display: block;
  margin-top: 12rpx;
}
</style>

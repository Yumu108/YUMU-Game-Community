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
        权限矩阵（2026-09-26 新增；同日第 3 轮改为 **可折叠 + 按操作位置分组**）。
        —— 「权限方案」最标准的呈现方式：把后端每一项权力摊平，逐条标出
           「**我这个角色能不能用**」×「**在哪做**」两个独立维度。
        🚨 两个维度别混：
             · 能不能用 → 行首 ✓ / ⊘（`allowed`，来自后端 AdminController 的真实注解）
             · 在哪做   → 分组标题 + 组徽标（`place`，端内已接按钮 / 仅主站后台）
           四种组合都真实存在：端内·可用（置顶、举报处理）、端内·不可用（版主看置顶）、
           主站·可用（版主隐藏回复）、主站·不可用（版主管理游戏库）。
        🚨 默认**折叠**：11 行平铺会把「我的」页撑成一屏半，用户真正想先看的是
           收藏/点赞列表。折叠态只留一行摘要（端内几项 / 主站几项），点标题栏展开。
        🚨 用 `v-if` 而不是 `v-show`：折叠时这些节点**必须真的不在 DOM 里** ——
           回归断言（PM 组）就是靠「点击前 0 个分组、点击后 ≥2 个」来验的；
           用 `v-show` 的话元素仍在，断言会变成永远为真的空转。
        🚨 表里的接口路径是后端**真实存在**的，单测会读 `AdminController.java`
           / `AdminUserController.java` 源码核对（`tests/roles.test.mjs` F 组） ——
           别在这里写不存在的接口，一写就红。
      -->
      <view v-if="groups.length" class="mx">
        <view class="mx__head" @click="mxOpen = !mxOpen">
          <view class="mx__head-main">
            <text class="mx__title">权限矩阵</text>
            <text class="mx__count">可执行 {{ capStats.allowed }} / {{ capStats.total }} 项</text>
          </view>
          <text class="mx__toggle">{{ mxOpen ? '收起 ▲' : '展开全部 ▼' }}</text>
        </view>

        <!-- 折叠态摘要：不展开也能看出「端内能点几个、主站能做几个」 -->
        <text class="mx__sum">{{ mxSum }}</text>

        <view v-if="mxOpen" class="mx__groups">
          <view v-for="g in groups" :key="g.key" class="mx__group">
            <view class="mx__group-head">
              <text class="mx__group-badge" :class="'mx__group-badge--' + g.key">{{ g.badge }}</text>
              <text class="mx__group-title">{{ g.title }}</text>
            </view>
            <text class="mx__group-hint">{{ g.hint }}</text>

            <view
              v-for="c in g.items"
              :key="c.key"
              class="mx__row"
              :class="{ 'mx__row--off': !c.allowed }"
            >
              <text class="mx__mark" :class="c.allowed ? 'mx__mark--on' : 'mx__mark--off'">
                {{ c.allowed ? '✓' : '⊘' }}
              </text>
              <view class="mx__item">
                <text class="mx__name">{{ c.name }}</text>
                <text class="mx__tag">{{ capTag(c) }}</text>
                <text v-if="c.note" class="mx__why">{{ c.note }}</text>
              </view>
            </view>
          </view>

          <text class="mx__note">
            ✓ = 当前角色可执行，⊘ = 无此项权限（仅管理员）。每项都对应后端真实接口，例如「置顶」= POST /admin/posts/{id}/pin；「限管辖范围」= 版主只能操作自己负责游戏下的内容。端内只决定「显示什么」，放行与否始终由后端 @PreAuthorize 判定。
          </text>
        </view>
      </view>

      <!--
        举报处理入口（2026-09-26 新增，**管理员 + 版主**都可见）。
        —— 这是矩阵里「处理举报」那一格的落地按钮（它本轮从「主站」搬到了「端内」）。
        🚨 判据 `canManageReports` = ADMIN **或** MODERATOR —— 与下面「用户权限管理」
           的 `canManageUsers`（只认 ADMIN）**故意不同**：
             · `/admin/reports` 挂在 `hasAnyRole('ADMIN','MODERATOR')` 的类下 ⇒ 版主能进
             · `/admin/users`   挂在 `hasRole('ADMIN')` 的类下            ⇒ 版主必 403
           两个都是 `/admin/**` 前缀，最容易看走眼；互换的后果一边是挖坑（点进去报错）、
           一边是把版主的主要工作藏起来。
      -->
      <view v-if="canManageReportsFlag" class="aentry aentry--reports" @click="goAdminReports">
        <view class="aentry__body">
          <text class="aentry__title">举报处理</text>
          <text class="aentry__sub">{{ reportEntrySub }}</text>
        </view>
        <text class="aentry__arrow">›</text>
      </view>

      <!--
        用户权限管理入口（2026-09-26 新增，**仅管理员**）。
        —— 这是上面矩阵里「搜索用户 · 修改角色 / 分配版主」那一格的落地按钮，
           让「端内可操作」这句声明有处可点。
        🚨 用 `canManageUsers`（只认 ADMIN）而不是 `canSeeManageEntry`（含版主）：
           后端 `AdminUserController` 是**类级** `hasRole('ADMIN')`，
           版主点进去调 `GET /admin/users` 必得 403，入口给了就是挖坑。
      -->
      <view v-if="canManageUsersFlag" class="aentry aentry--users" @click="goAdminUsers">
        <view class="aentry__body">
          <text class="aentry__title">用户权限管理</text>
          <text class="aentry__sub">搜索用户 · 修改角色 · 分配版主（仅管理员）</text>
        </view>
        <text class="aentry__arrow">›</text>
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
import { permissionSummary, badgeMeta, canSeeManageEntry, actionsFor, capabilityGroups, capabilityGroupStats, canManageUsers, canManageReports } from '../../utils/roles'
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
 * 矩阵分组 —— 数据源是 `capabilityGroups`（已按「小程序内 / 主站」切好）。
 *
 * ⚠️ 只有 ADMIN / MODERATOR 才渲染 —— 普通用户看一张全 ⊘ 的表没有意义
 *    （计数也能算出 0/11，但那是噪音不是信息）。
 * ⚠️ 分组是为了让「**哪几项真能在手机上点**」一眼可辨：平铺时那层区分只藏在
 *    每行的小灰字里，扫不出来（用户 9-26 的原话就是「有的没有体现」）。
 */
const groups = computed(() => {
  const roles = (user.value && user.value.roles) || []
  return canSeeManageEntry(roles) ? capabilityGroups(roles) : []
})

/** 矩阵展开态（默认折叠：先把收藏/点赞列表让出来，矩阵是「想细看时再点」的信息） */
const mxOpen = ref(false)

/**
 * 计数 + 分组统计 —— 标题上的「可执行 N / M 项」与折叠摘要都从这里取。
 * 数字本身就是 ADMIN 与 MODERATOR 差异最直观的表达（11 vs 5）。
 */
const capStats = computed(() => capabilityGroupStats((user.value && user.value.roles) || []))

/**
 * 折叠态那一行摘要：「小程序内 3 / 6 项 · 主站 2 / 5 项」。
 * 🚨 「3 / 6」= 我这角色在端内能点 3 个、端内一共接了 6 个 ——
 *    分母是**端内已接总数**（跟矩阵一样是全局常数），分子才随角色变。
 *    这样一眼能看出两件事：端内覆盖了多少、以及我占其中几项。
 */
const mxSum = computed(() => {
  const s = capStats.value
  return `小程序内 ${s.allowedMp} / ${s.mp} 项 · 主站 ${s.allowedSite} / ${s.site} 项`
})

/**
 * 是否显示「用户权限管理」入口 —— **仅管理员**。
 * 🚨 与详情页那句「管理」入口的判据**故意不同**：
 *    那边 `canSeeManageEntry` 是 `hasAnyRole(ADMIN,MODERATOR)`（帖子接口的注解就是它）；
 *    这边 `canManageUsers` 只认 ADMIN（`AdminUserController` 是类级 hasRole('ADMIN')）。
 *    串用会让版主点进去吃 403。
 */
const canManageUsersFlag = computed(() => canManageUsers((user.value && user.value.roles) || []))

/**
 * 是否显示「举报处理」入口 —— **管理员与版主都显示**。
 * 🚨 与上面的 `canManageUsersFlag` 是**两个不同谓词**，别合并：
 *    举报接口在 `hasAnyRole('ADMIN','MODERATOR')` 的类下（版主能进），
 *    用户管理接口在 `hasRole('ADMIN')` 的类下（版主 403）。见 utils/roles.js 注释。
 */
const canManageReportsFlag = computed(() => canManageReports((user.value && user.value.roles) || []))

/**
 * 举报入口的副标题 —— 说清「我会看到的范围」，因为管理员与版主进的是同一个页面、
 * 拿到的却是不同集合（后端按游戏切分）。让版主误以为是全站队列是最容易犯的错。
 */
const reportEntrySub = computed(() => {
  const roles = (user.value && user.value.roles) || []
  if (roles.includes('ADMIN')) return '全站举报队列 · 标记违规 / 驳回'
  const games = (user.value && user.value.moderatorGameNames) || []
  return games.length
    ? `只看《${games.join('、')}》的举报 · 标记违规 / 驳回`
    : '举报处理 · 暂未分配负责游戏'
})

/** 进入用户权限管理页（ADMIN only，见上方注释） */
function goAdminUsers() {
  uni.navigateTo({ url: '/pages/admin/users' })
}

/** 进入举报处理页（ADMIN + MODERATOR，见上方注释） */
function goAdminReports() {
  uni.navigateTo({ url: '/pages/admin/reports' })
}

/**
 * 给矩阵每行拼一句短标注 —— 只讲「**能不能**」与「**范围多大**」。
 *
 * 🚨 「在哪做」（端内 / 主站）**不在这里重复**：那个维度已经由所属分组
 *    的标题与组徽标表达了。若两边都写，行内会出现「主站 · 主站操作」这类
 *    自相矛盾的赘述；改文案时也容易只改一处（第二处漂移）。
 *    ⇒ 一个维度只有一处事实来源。
 */
function capTag(c) {
  if (!c.allowed) return c.adminOnly ? '仅管理员可执行' : '当前角色无此权限'
  return c.scoped ? '限管辖范围' : '全站生效'
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
/* 整行可点：折叠 / 展开。给一点负边距让点击热区更宽裕，别只让文字能点 */
.mx__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mx__head-main {
  display: flex;
  align-items: baseline;
  min-width: 0;
}
.mx__title {
  font-size: 25rpx;
  font-weight: 600;
  color: #e9e7f2;
}
.mx__count {
  flex: none;
  margin-left: 14rpx;
  font-size: 21rpx;
  color: #cbbdff;
}
/* 展开 / 收起指示 —— 文字 + 箭头，比纯箭头更明确（「▼」在深色底上易被忽略） */
.mx__toggle {
  flex: none;
  margin-left: 16rpx;
  font-size: 20rpx;
  color: #8f7bff;
}
/* 折叠态摘要：端内几项 / 主站几项，不展开也能看清分布 */
.mx__sum {
  display: block;
  margin-top: 8rpx;
  font-size: 20rpx;
  color: #6f6982;
}
.mx__groups {
  margin-top: 16rpx;
}
.mx__group + .mx__group {
  margin-top: 20rpx;
  padding-top: 18rpx;
  border-top: 1rpx dashed #2f2a40;
}
.mx__group-head {
  display: flex;
  align-items: center;
}
/* 组徽标 —— 「在哪做」这个维度的唯一视觉载体（行内不再重复，见 capTag 注释） */
.mx__group-badge {
  flex: none;
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  font-size: 19rpx;
  line-height: 1.7;
}
.mx__group-badge--mp {
  background: rgba(93, 202, 165, 0.14);
  color: #5dcaa5;
}
.mx__group-badge--site {
  background: rgba(124, 92, 255, 0.14);
  color: #a894ff;
}
.mx__group-title {
  margin-left: 12rpx;
  font-size: 23rpx;
  font-weight: 600;
  color: #d9d6e6;
}
.mx__group-hint {
  display: block;
  margin-top: 6rpx;
  font-size: 19rpx;
  color: #6f6982;
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
.mx__item {
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
/* 「为什么不在端内做」—— 只在有话说时出现，别给每行都塞一句 */
.mx__why {
  margin-top: 2rpx;
  font-size: 18rpx;
  color: #5f5a72;
}
.mx__note {
  display: block;
  margin-top: 16rpx;
  padding-top: 14rpx;
  border-top: 1rpx solid #2a2538;
  font-size: 19rpx;
  line-height: 1.65;
  color: #6f6982;
}
/* 用户权限管理入口（仅管理员）—— 卡片里的一个可点条目，样式对齐 .ai-entry 那类入口 */
.aentry {
  display: flex;
  align-items: center;
  margin-top: 16rpx;
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  background: rgba(124, 92, 255, 0.1);
  border: 1rpx solid rgba(124, 92, 255, 0.28);
}
.aentry__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.aentry__title {
  font-size: 25rpx;
  font-weight: 600;
  color: #e9e7f2;
}
.aentry__sub {
  margin-top: 4rpx;
  font-size: 19rpx;
  color: #9c96ad;
}
.aentry__arrow {
  flex: none;
  margin-left: 12rpx;
  font-size: 30rpx;
  color: #8f7bff;
}
/*
 * 举报处理入口换个色系（青绿）—— 两个入口会同时出现在管理员眼前，
 * 全紫会看成「一件事分了两块」。配色也给语义：青绿=日常审核队列，紫=后台配置。
 * 只换色不改结构，`.aentry` 的布局规则完全复用。
 */
.aentry--reports {
  background: rgba(93, 202, 165, 0.1);
  border-color: rgba(93, 202, 165, 0.28);
}
.aentry--reports .aentry__arrow {
  color: #5dcaa5;
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

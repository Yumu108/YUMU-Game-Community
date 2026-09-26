<template>
  <view class="adm">
    <!--
      非管理员兜底（2026-09-26）。
      🚨 为什么需要它：H5 是 **hash 路由**，任何人手敲 /m/#/pages/admin/users 都能进这个页面
         （端内跳转不是安全边界）。后端当然会 403，但直接弹红字很难看，而且会白挨 3 次请求。
         这里先用本地角色判一次：不是管理员就只渲染一段说明、**一个请求都不发**。
         —— 这与详情页「游客不发 can-review」是同一条原则，见 utils/roles.js 头部。
    -->
    <view v-if="!isAdmin" class="deny">
      <text class="deny__t">仅管理员可访问</text>
      <text class="deny__d">
        用户与角色管理是管理员专属能力（后端 AdminUserController 上是类级 @PreAuthorize("hasRole('ADMIN')")，版主同样会被拒绝）。
      </text>
      <view class="deny__btn" @click="back">返回</view>
    </view>

    <template v-else>
      <view class="tip">
        <text class="tip__t">用户权限管理</text>
        <text class="tip__d">搜索用户 → 修改角色 / 分配负责游戏。角色改动即时生效（后端每次请求都按库里的最新角色判定），对方无需重新登录。</text>
      </view>

      <!--
        搜索栏。关键词在后端是 `username` **或** `nickname` 的 LIKE 模糊匹配
        （AdminUserServiceImpl#listUsers），所以文案如实写「模糊匹配」，
        别让管理员以为输入完整账号就只会命中一个。
      -->
      <view class="sbar">
        <input
          v-model="kw"
          class="sbar__in"
          placeholder="搜索用户名 / 昵称"
          placeholder-class="adm-ph"
          confirm-type="search"
          @confirm="search"
        />
        <text v-if="kw" class="sbar__clear" @click="clearKw">✕</text>
        <text class="sbar__go" @click="search">搜索</text>
      </view>

      <view v-if="loading" class="st">加载中…</view>
      <view v-else-if="failed" class="st st--err" @click="load(1)">加载失败，点此重试</view>
      <view v-else-if="!list.length" class="st">
        {{ kw ? `没有匹配「${kw}」的用户` : '暂无用户' }}
      </view>

      <template v-else>
        <view class="ul">
          <view
            v-for="u in list"
            :key="u.id"
            class="ut"
            :class="{ 'ut--self': u.id === myId }"
            @click="openEdit(u)"
          >
            <image v-if="avatarOf(u)" class="ut__av" :src="avatarOf(u)" mode="aspectFill" />
            <text v-else class="ut__av ut__av--ph">{{ initialOf(u) }}</text>

            <view class="ut__body">
              <view class="ut__line">
                <text class="ut__name">{{ u.nickname || u.username }}</text>
                <text v-if="u.id === myId" class="ut__me">你</text>
                <text
                  v-for="r in u.roles || []"
                  :key="r"
                  class="ut__role"
                  :class="'ut__role--' + roleTone(r)"
                >{{ roleLabel(r) }}</text>
                <text v-if="u.status === 1" class="ut__ban">已封禁</text>
              </view>
              <text class="ut__sub">@{{ u.username }} · ID {{ u.id }}</text>
              <!-- 版主的负责游戏（来自 moderatorAssignments.gameName）—— 一眼看出管辖范围 -->
              <text v-if="modGames(u)" class="ut__game">负责游戏：{{ modGames(u) }}</text>
            </view>

            <text class="ut__go">改权限 ›</text>
          </view>
        </view>

        <view v-if="hasMore" class="more" @click="load(current + 1)">
          加载更多（{{ list.length }} / {{ total }}）
        </view>
        <text v-else class="total">共 {{ total }} 位用户</text>
      </template>
    </template>

    <!--
      角色编辑面板。
      🚨 遮罩必须是**独立兄弟节点**，不能用 `@click.self` ——
         uni-app 编译到 mp-weixin 时 `.self` 修饰符会被静默丢弃（H5 正常），
         于是「点遮罩关闭」在小程序端失效。这个坑本项目已经踩过一次。
    -->
    <view v-if="sheet" class="sh">
      <view class="sh__mask" @click="closeEdit"></view>
      <view class="sh__panel">
        <view class="sh__head">
          <text class="sh__title">修改权限</text>
          <text class="sh__close" @click="closeEdit">✕</text>
        </view>

        <view v-if="cur" class="sh__user">
          <text class="sh__uname">{{ cur.nickname || cur.username }}</text>
          <text class="sh__usub">@{{ cur.username }} · ID {{ cur.id }}</text>
        </view>

        <!-- 角色：单选。与主站一致（用户同一时间只能拥有一种角色），见 roles.js#ASSIGNABLE_ROLES -->
        <text class="sh__label">角色（单选）</text>
        <view class="ropt">
          <view
            v-for="o in ROLES"
            :key="o.code"
            class="ropt__item"
            :class="{ 'ropt__item--on': pickedRole === o.code }"
            @click="pickRole(o.code)"
          >
            <view class="ropt__radio">
              <view v-if="pickedRole === o.code" class="ropt__dot" />
            </view>
            <view class="ropt__body">
              <text class="ropt__name">{{ o.label }}</text>
              <text class="ropt__desc">{{ o.desc }}</text>
            </view>
          </view>
        </view>

        <!-- 版主才需要指定负责游戏（后端 MAX_GAMES_PER_MOD = 1，只能选 1 个） -->
        <template v-if="pickedRole === 'MODERATOR'">
          <view class="sh__label-row">
            <text class="sh__label">负责游戏</text>
            <text class="sh__label-tip">单选 · 一名版主只能负责 1 个游戏</text>
          </view>
          <input
            v-model="gameKw"
            class="gfilter"
            placeholder="筛选游戏名"
            placeholder-class="adm-ph"
          />
          <scroll-view class="glist" scroll-y>
            <view v-if="gamesLoading" class="glist__empty">游戏列表加载中…</view>
            <view v-else-if="!filteredGames.length" class="glist__empty">
              {{ games.length ? '没有匹配的游戏' : '游戏列表加载失败，可稍后重试' }}
            </view>
            <!--
              🚨 `v-else` 不能和 `v-for` 写在同一元素上：Vue 3 里 v-if/v-else 优先级高于
                 v-for（v2 相反），同元素混用会编译失败或行为不可预期。这里用 `<template v-else>`
                 把它们分开 —— 这也是本项目回归脚本里 `count('.glist__item')` 能稳定的前提。
            -->
            <template v-else>
              <view
                v-for="g in filteredGames"
                :key="g.id"
                class="glist__item"
                :class="{ 'glist__item--on': pickedGame === g.id }"
                @click="pickedGame = pickedGame === g.id ? null : g.id"
              >
                <view class="ropt__radio">
                  <view v-if="pickedGame === g.id" class="ropt__dot" />
                </view>
                <text class="glist__name">{{ g.name }}</text>
                <text class="glist__id">#{{ g.id }}</text>
              </view>
            </template>
          </scroll-view>
        </template>

        <!--
          自保提示：管理员改自己时把风险说在前面。
          规则与后端 AdminUserServiceImpl#updateUserRoles 的自保完全一致
          （只拦「摘掉自己的 ADMIN」），见 utils/roles.js#selfRoleChangeBlocked。
        -->
        <view v-if="isSelf" class="sh__self">
          <text class="sh__self-t">
            这是你自己的账号。可以维持「管理员」，但**不能把自己改成其他角色** ——
            一旦摘掉 ADMIN，手上的登录态下一跳就失效，后台会没人能进（此操作不可逆）。
          </text>
        </view>

        <view class="sh__btns">
          <view class="sh__btn" @click="closeEdit">取消</view>
          <view
            class="sh__btn sh__btn--primary"
            :class="{ 'sh__btn--off': !canSave }"
            @click="save"
          >{{ busy ? '保存中…' : '保存' }}</view>
        </view>

        <text class="sh__note">
          保存时先提交角色（PUT /admin/users/{id}/roles），再提交负责游戏（PUT /admin/users/{id}/moderator-boards）；改成非版主时后端会自动清空已分配的游戏。
        </text>
      </view>
    </view>
  </view>
</template>

<script setup>
/**
 * 用户权限管理（2026-09-26 新增）—— 仅管理员。
 *
 * ══════════════════ 这个页面为什么存在 ══════════════════
 * 上一版权限矩阵里有一行「搜索用户 · 修改角色 / 分配版主」被标成「主站操作」。
 * 用户反馈：矩阵里好几项在小程序端都没有体现，希望把「端内能做 / 只能去主站」
 * 分清楚，并且**给管理员加一个能搜索用户并改权限的功能**。
 * ⇒ 于是这一项从「主站」搬到「端内」，矩阵那一格也跟着改成 mp: true。
 *
 * ══════════════════ 后端零改动 ══════════════════
 * `/admin/users` 系列接口**本来就存在**（主站管理后台在用）：
 *   · GET  /admin/users?keyword=&current=&size=  搜索 + 分页
 *   · PUT  /admin/users/{id}/roles               改角色
 *   · PUT  /admin/users/{id}/moderator-boards    分配负责游戏
 * 端内只是换了个更轻的交互。唯一动后端的是一处**安全加固**：
 * `updateUserRoles` 新增「不能摘掉自己的 ADMIN」自保（见该文件注释）。
 *
 * ══════════════════ 三条容易踩的线 ══════════════════
 *  ① 权限闸门只认 ADMIN。`AdminUserController` 是**类级** `hasRole('ADMIN')`，
 *     版主调 `GET /admin/users` 一样 403 —— 所以不能用 `canSeeManageEntry`
 *     （那个含版主，是帖子类接口的口径），必须用 `canManageUsers`。
 *  ② 角色是**单选**（与主站 `el-radio-group` 一致）。后端其实支持多角色，
 *     但同一套接口不该有两种语义；库里历史数据 `MODERATOR,USER` 只影响**读**
 *     （`hasRole` 用 includes），**写**一律单元素数组。
 *  ③ 保存顺序：先 roles 再 moderator-boards。反过来的话，后端在改角色那一步
 *     会把「非版主」的游戏清空，刚提交的游戏白写。
 *     （恰好顺序也就对了：改角色 → 若仍是版主才补游戏。）
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getUser } from '../../utils/store'
import { resolveImage } from '../../utils/format'
import {
  ASSIGNABLE_ROLES,
  ROLE,
  roleLabel,
  roleTone,
  canManageUsers,
  selfRoleChangeBlocked
} from '../../utils/roles'
import {
  fetchAdminUsers,
  updateUserRoles,
  setModeratorBoards
} from '../../api/admin'
import { fetchGames } from '../../api/community'

const ROLES = ASSIGNABLE_ROLES

const myId = ref(null)
const isAdmin = ref(false)

const kw = ref('')
const list = ref([])
const total = ref(0)
const current = ref(1)
const loading = ref(false)
const failed = ref(false)

/** 还有下一页吗：后端返回的 total 与已加载条数比较（不依赖 pages 字段，少一处耦合） */
const hasMore = computed(() => list.value.length < (total.value || 0))

/* ---------------- 面板状态 ---------------- */
const sheet = ref(false)
const cur = ref(null)
const pickedRole = ref(ROLE.USER)
const pickedGame = ref(null)
const busy = ref(false)
const isSelf = computed(() => !!cur.value && cur.value.id === myId.value)

/* ---------------- 游戏列表（懒加载 + 本地筛选） ---------------- */
const games = ref([])
const gamesLoading = ref(false)
const gameKw = ref('')
const filteredGames = computed(() => {
  const k = gameKw.value.trim().toLowerCase()
  if (!k) return games.value
  return games.value.filter((g) => String(g.name || '').toLowerCase().includes(k))
})

/**
 * 保存按钮是否可用。
 * 两条前置：版主必须指定游戏（后端 400）、不能摘掉自己的 ADMIN（后端 400）。
 * ⚠️ 这里只做「提前说清」，**不是安全边界** —— 后端同样有校验。
 */
const canSave = computed(() => {
  if (!cur.value || busy.value) return false
  if (pickedRole.value === ROLE.MODERATOR && pickedGame.value == null) return false
  if (selfRoleChangeBlocked(myId.value, cur.value.id, [pickedRole.value])) return false
  return true
})

function avatarOf(u) {
  return resolveImage((u && u.avatar) || '')
}
/** 没有头像时显示昵称首字（与「我的」页的占位一致） */
function initialOf(u) {
  const n = (u && (u.nickname || u.username)) || '?'
  return String(n).charAt(0)
}
/** 版主的负责游戏名，多个用 / 连（业务上只有 1 个，但历史数据可能多） */
function modGames(u) {
  const arr = (u && u.moderatorAssignments) || []
  const names = arr.map((a) => a && a.gameName).filter(Boolean)
  return names.join(' / ')
}

/* ---------------- 数据加载 ---------------- */

/**
 * 拉取用户列表。
 * @param {number} page 页码（1 = 重新搜索）
 * ⚠️ 失败**不清空**已有列表：搜索时网络抖一下就把结果清空，体验比留着旧数据差得多。
 */
async function load(page = 1) {
  if (loading.value) return
  loading.value = true
  failed.value = false
  try {
    const r = (await fetchAdminUsers(kw.value.trim(), { current: page, size: 20 })) || {}
    const recs = r.records || []
    if (page === 1) list.value = recs
    else list.value = list.value.concat(recs)
    total.value = r.total || recs.length
    current.value = page
  } catch (e) {
    failed.value = list.value.length === 0
  } finally {
    loading.value = false
  }
}

function search() {
  list.value = []
  load(1)
}

function clearKw() {
  kw.value = ''
  list.value = []
  load(1)
}

/**
 * 拉全部游戏（供版主分配用）。
 *
 * 🚨 `/games` 的 size 后端钳制在 1..100（`GameServiceImpl#clampSize`），
 *    线上 81 个游戏正好一页装得下；但**不能假设以后也装得下** ——
 *    超出 100 时会静默少掉游戏（管理员搜不到那个游戏 = 以为游戏不存在），
 *    所以这里按 `pages` 继续翻页（最多 3 页 = 300 个，够用很久）。
 */
async function loadGames() {
  if (games.value.length || gamesLoading.value) return
  gamesLoading.value = true
  const out = []
  try {
    const size = 100
    const first = (await fetchGames({ current: 1, size })) || {}
    const push = (recs) => {
      (recs || []).forEach((g) => {
        if (g && g.id != null && !out.some((x) => x.id === g.id)) {
          out.push({ id: g.id, name: g.name || `游戏#${g.id}` })
        }
      })
    }
    push(first.records)
    const pages = Math.min(3, Number(first.pages) || 1)
    for (let p = 2; p <= pages; p += 1) {
      const r = (await fetchGames({ current: p, size })) || {}
      push(r.records)
    }
    games.value = out
  } catch (e) {
    /* 失败保留空数组，UI 会提示「加载失败」；不阻塞下面的角色操作 */
  } finally {
    gamesLoading.value = false
  }
}

/* ---------------- 面板交互 ---------------- */

/**
 * 选择角色。
 *
 * 🚨 必须**在这里**（而不是只在 `openEdit` 里）触发游戏列表加载 ——
 *    否则出现「打开面板时目标是普通用户 → 不打游戏接口；接着改选版主 → 游戏列表永远空白」。
 *    这个 bug 只有点过一遍才会暴露（静态看代码很难发现），
 *    已被回归脚本的 PM50 钉住（改选版主后必须出现 ≥1 个游戏项）。
 *    `loadGames()` 自带「已加载就返回」，所以重复点不会重复请求。
 */
async function pickRole(code) {
  pickedRole.value = code
  if (code === ROLE.MODERATOR) await loadGames()
}

/**
 * 打开编辑面板。
 * ⚠️ 角色默认值取 `roles[0]`（与主站一致）—— 库里有历史数据是 `MODERATOR,USER`
 *    这种两元素数组，取第一个即可（后端写入时也是单元素）。
 */
async function openEdit(u) {
  cur.value = u
  const roles = (u.roles || []).filter((r) => r)
  pickedRole.value = roles.length ? roles[0] : ROLE.USER
  pickedGame.value = null
  gameKw.value = ''
  sheet.value = true

  if (pickedRole.value === ROLE.MODERATOR) {
    // 预填已有授权（列表接口已带 moderatorAssignments）
    const a = (u.moderatorAssignments || []).find((x) => x && x.gameId != null)
    if (a) pickedGame.value = a.gameId
    await loadGames()
    // 已有授权但不在游戏列表里（游戏被下架/改名）⇒ 补进去，否则管理员取消不掉它
    if (a && a.gameId != null && !games.value.some((g) => g.id === a.gameId)) {
      games.value = [{ id: a.gameId, name: a.gameName || `游戏#${a.gameId}` }].concat(games.value)
    }
  }
}

function closeEdit() {
  sheet.value = false
  cur.value = null
  busy.value = false
}

/**
 * 保存。顺序：先 roles → 再 moderator-boards（理由见文件头 ③）。
 *
 * 🚨 与点赞/收藏同一套铁律：**不做乐观更新** —— 成功与否只看服务端响应，
 *    成功后重新拉一次列表让页面回到服务端事实。
 * ⚠️ 失败时什么都不做：请求层会把后端原文 toast 出来（例如自保提示
 *    「不能移除自己的管理员角色，否则将无人可管理后台」），别吞掉它 ——
 *    那正是「后端才是安全边界」的证据。
 */
async function save() {
  if (!cur.value || busy.value) return
  if (!canSave.value) {
    const msg = selfRoleChangeBlocked(myId.value, cur.value.id, [pickedRole.value])
      ? '不能移除自己的管理员角色'
      : '请选择 1 个负责游戏'
    uni.showToast({ title: msg, icon: 'none' })
    return
  }
  busy.value = true
  try {
    await updateUserRoles(cur.value.id, [pickedRole.value])
    if (pickedRole.value === ROLE.MODERATOR) {
      await setModeratorBoards(cur.value.id, [pickedGame.value])
    }
    const label = roleLabel(pickedRole.value)
    uni.showToast({ title: `已改为「${label}」`, icon: 'none', duration: 1800 })
    sheet.value = false
    cur.value = null
    await load(current.value)
  } catch (e) {
    /* 失败文案已由请求层 toast 后端原文；本地状态保持不变 */
  } finally {
    busy.value = false
  }
}

function back() {
  uni.navigateBack()
}

/**
 * 进页面先做本地角色闸门（见模板顶部 deny 块的理由）。
 * 只有确认是 ADMIN 才发第一个请求 —— 否则普通用户/版主会白挨一次 403 红字。
 */
onLoad(() => {
  const me = getUser() || {}
  myId.value = me.id == null ? null : Number(me.id)
  isAdmin.value = canManageUsers(me.roles || [])
  if (isAdmin.value) load(1)
})
</script>

<!--
  ⚠️ 这一块**故意不加 scoped**。
  为什么：`placeholder-class` 指定的类被加到 uni-app 运行时**动态创建**的占位元素上，
  那个元素不带 Vue 的 scoped 属性（`data-v-xxx`），所以 scoped 选择器
  （会被编译成 `.adm-ph[data-v-xxx]`）根本匹配不到 —— 占位文字会退回浏览器默认色，
  在深色底上几乎看不清。项目里现有的 `placeholder-class="ph"` 全项目都没定义过
  （.ph 到处引用、无处定义），属于同一个坑，这里不再复制。
-->
<style>
.adm-ph {
  color: #6f6982;
  font-size: 26rpx;
}
</style>

<style scoped>
.adm {
  min-height: 100vh;
  padding: 20rpx 24rpx calc(40rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

/* ---------------- 非管理员兜底 ---------------- */
.deny {
  margin-top: 120rpx;
  padding: 40rpx 32rpx;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 24rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.deny__t {
  font-size: 30rpx;
  font-weight: 600;
  color: #e9e7f2;
}
.deny__d {
  margin-top: 16rpx;
  font-size: 23rpx;
  line-height: 1.7;
  color: #8b8599;
}
.deny__btn {
  margin-top: 32rpx;
  padding: 14rpx 48rpx;
  border-radius: 999rpx;
  border: 1rpx solid #3a3350;
  color: #a49eb6;
  font-size: 25rpx;
}

/* ---------------- 说明条 ---------------- */
.tip {
  display: flex;
  flex-direction: column;
  padding: 22rpx 24rpx;
  background: rgba(124, 92, 255, 0.1);
  border: 1rpx solid rgba(124, 92, 255, 0.26);
  border-radius: 20rpx;
}
.tip__t {
  font-size: 26rpx;
  font-weight: 600;
  color: #cbbdff;
}
.tip__d {
  margin-top: 8rpx;
  font-size: 21rpx;
  line-height: 1.7;
  color: #a49eb6;
}

/* ---------------- 搜索栏 ---------------- */
.sbar {
  display: flex;
  align-items: center;
  margin-top: 20rpx;
  padding: 0 20rpx;
  height: 84rpx;
  background: #231f31;
  border: 1rpx solid #2a2538;
  border-radius: 18rpx;
}
.sbar__in {
  flex: 1;
  min-width: 0;
  height: 84rpx;
  font-size: 26rpx;
  color: #e9e7f2;
}
.sbar__clear {
  flex: none;
  padding: 0 12rpx;
  font-size: 24rpx;
  color: #6f6982;
}
.sbar__go {
  flex: none;
  margin-left: 8rpx;
  padding: 10rpx 26rpx;
  border-radius: 999rpx;
  background: #7c5cff;
  color: #fff;
  font-size: 24rpx;
  font-weight: 600;
}

/* ---------------- 状态提示 ---------------- */
.st {
  margin-top: 28rpx;
  padding: 32rpx 0;
  text-align: center;
  font-size: 24rpx;
  color: #6f6982;
}
.st--err {
  color: #f0b45f;
}

/* ---------------- 用户列表 ---------------- */
.ul {
  margin-top: 20rpx;
}
.ut {
  display: flex;
  align-items: center;
  padding: 22rpx 24rpx;
  margin-bottom: 14rpx;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 20rpx;
}
/* 自己的账号描边高亮 —— 免得管理员手滑改到自己（改角色对自我操作**会**被后端拦） */
.ut--self {
  border-color: rgba(240, 180, 95, 0.5);
}
.ut__av {
  flex: none;
  width: 76rpx;
  height: 76rpx;
  border-radius: 50%;
  background: #3a3350;
}
.ut__av--ph {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #cbbdff;
  font-size: 30rpx;
}
.ut__body {
  flex: 1;
  min-width: 0;
  margin-left: 20rpx;
  display: flex;
  flex-direction: column;
}
.ut__line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}
.ut__name {
  font-size: 27rpx;
  font-weight: 600;
  color: #e9e7f2;
  margin-right: 10rpx;
}
.ut__me {
  flex: none;
  margin-right: 10rpx;
  padding: 1rpx 10rpx;
  border-radius: 999rpx;
  background: rgba(240, 180, 95, 0.16);
  color: #f0b45f;
  font-size: 18rpx;
}
/* 角色标签配色沿用后端 BadgeService 词表（danger=管理员 / warning=版主） */
.ut__role {
  flex: none;
  margin-right: 8rpx;
  padding: 1rpx 12rpx;
  border-radius: 999rpx;
  font-size: 19rpx;
}
.ut__role--danger {
  background: rgba(240, 90, 90, 0.16);
  color: #ff8b8b;
}
.ut__role--warning {
  background: rgba(240, 180, 95, 0.16);
  color: #f0b45f;
}
.ut__role--default {
  background: rgba(124, 92, 255, 0.16);
  color: #a894ff;
}
.ut__ban {
  flex: none;
  padding: 1rpx 12rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.06);
  color: #8b8599;
  font-size: 19rpx;
}
.ut__sub {
  margin-top: 6rpx;
  font-size: 21rpx;
  color: #6f6982;
}
.ut__game {
  margin-top: 4rpx;
  font-size: 21rpx;
  color: #5dcaa5;
}
.ut__go {
  flex: none;
  margin-left: 12rpx;
  font-size: 22rpx;
  color: #8f7bff;
}

.more {
  margin-top: 8rpx;
  padding: 24rpx 0;
  text-align: center;
  font-size: 23rpx;
  color: #8f7bff;
}
.total {
  display: block;
  margin-top: 16rpx;
  text-align: center;
  font-size: 21rpx;
  color: #6f6982;
}

/* ---------------- 编辑面板 ---------------- */
.sh {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  /* 高于详情页的管理面板（1300）—— 两个不会同时出现，但留出层级余量 */
  z-index: 1400;
}
.sh__mask {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
}
.sh__panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  padding: 28rpx 28rpx calc(28rpx + env(safe-area-inset-bottom));
  background: #1a1725;
  border-top: 1rpx solid #2a2538;
  border-radius: 28rpx 28rpx 0 0;
  box-sizing: border-box;
}
.sh__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sh__title {
  font-size: 30rpx;
  font-weight: 600;
  color: #e9e7f2;
}
.sh__close {
  padding: 0 8rpx;
  font-size: 28rpx;
  color: #6f6982;
}
.sh__user {
  margin-top: 14rpx;
  display: flex;
  align-items: baseline;
}
.sh__uname {
  font-size: 26rpx;
  color: #cbbdff;
  font-weight: 600;
}
.sh__usub {
  margin-left: 12rpx;
  font-size: 21rpx;
  color: #6f6982;
}
.sh__label {
  display: block;
  margin-top: 24rpx;
  margin-bottom: 12rpx;
  font-size: 23rpx;
  color: #a49eb6;
}
.sh__label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.sh__label-tip {
  font-size: 19rpx;
  color: #6f6982;
}

/* ---------------- 角色单选 ---------------- */
.ropt {
  display: flex;
  flex-direction: column;
}
.ropt__item {
  display: flex;
  align-items: center;
  padding: 18rpx 20rpx;
  margin-bottom: 12rpx;
  background: #221d33;
  border: 1rpx solid #2a2538;
  border-radius: 18rpx;
}
.ropt__item--on {
  border-color: #7c5cff;
  background: rgba(124, 92, 255, 0.14);
}
.ropt__radio {
  flex: none;
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  border: 2rpx solid #4a4266;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ropt__item--on .ropt__radio {
  border-color: #8f7bff;
}
.ropt__dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  background: #8f7bff;
  display: block;
}
.ropt__body {
  flex: 1;
  min-width: 0;
  margin-left: 16rpx;
  display: flex;
  flex-direction: column;
}
.ropt__name {
  font-size: 25rpx;
  color: #e9e7f2;
}
.ropt__desc {
  margin-top: 4rpx;
  font-size: 20rpx;
  line-height: 1.55;
  color: #8b8599;
}

/* ---------------- 游戏选择 ---------------- */
.gfilter {
  height: 72rpx;
  padding: 0 20rpx;
  background: #231f31;
  border: 1rpx solid #2a2538;
  border-radius: 16rpx;
  font-size: 24rpx;
  color: #e9e7f2;
}
.glist {
  margin-top: 12rpx;
  max-height: 420rpx;
  background: #221d33;
  border: 1rpx solid #2a2538;
  border-radius: 18rpx;
}
.glist__empty {
  padding: 32rpx 0;
  text-align: center;
  font-size: 22rpx;
  color: #6f6982;
}
.glist__item {
  display: flex;
  align-items: center;
  padding: 18rpx 20rpx;
  border-bottom: 1rpx solid #2a2538;
}
.glist__item--on {
  background: rgba(124, 92, 255, 0.14);
}
.glist__item--on .ropt__radio {
  border-color: #8f7bff;
}
.glist__name {
  flex: 1;
  min-width: 0;
  margin-left: 16rpx;
  font-size: 24rpx;
  color: #e9e7f2;
}
.glist__id {
  flex: none;
  margin-left: 10rpx;
  font-size: 19rpx;
  color: #5f5a72;
}

/* ---------------- 自保提示 ---------------- */
.sh__self {
  margin-top: 22rpx;
  padding: 18rpx 20rpx;
  background: rgba(240, 180, 95, 0.1);
  border: 1rpx solid rgba(240, 180, 95, 0.3);
  border-radius: 16rpx;
}
.sh__self-t {
  font-size: 21rpx;
  line-height: 1.7;
  color: #f0b45f;
}

/* ---------------- 底部按钮 ---------------- */
.sh__btns {
  display: flex;
  margin-top: 28rpx;
}
.sh__btn {
  flex: 1;
  height: 84rpx;
  line-height: 84rpx;
  text-align: center;
  border-radius: 16rpx;
  border: 1rpx solid #3a3350;
  color: #a49eb6;
  font-size: 27rpx;
}
.sh__btn--primary {
  margin-left: 18rpx;
  background: #7c5cff;
  border-color: #7c5cff;
  color: #fff;
  font-weight: 600;
}
/* 不可保存时降透明度（不是隐藏 —— 按钮还在，用户能看出「有个保存但当前不能点」） */
.sh__btn--off {
  opacity: 0.4;
}
.sh__note {
  display: block;
  margin-top: 18rpx;
  font-size: 19rpx;
  line-height: 1.7;
  color: #5f5a72;
}
</style>

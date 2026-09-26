<template>
  <view v-if="post" class="mp-page">
    <!--
      非公开帖（status=1 隐藏 / 2 待审）横幅。
      🚨 说明：后端对**匿名**访问这类帖直接 404（可见性矩阵见 PostServiceImpl#getDetail），
        所以游客正常拿不到；登录后（2026-09-17 起本端已接入与主站通用的账号）作者本人 /
        管理员可能拿到预览态，这里按 `status/previewOnly` 兜底渲染 —— 按主站规则它应当
        **完全只读**（底部操作条与举报入口都由 `isNonPublic` 拦掉）。
    -->
    <view v-if="flagText" class="flag">
      <text class="flag__text">{{ flagText }}</text>
    </view>

    <!-- 标题 -->
    <text class="title">{{ post.title }}</text>
    <view class="meta">
      <!-- 平台角标：定位改为「多平台攻略聚合」后，先亮明这篇属于哪个平台 -->
      <text v-if="post.platform" class="pcplat" :class="'pcplat--' + platKey">{{ platLabel }}</text>
      <text v-if="post.gameName" class="mp-tag mp-tag--purple">{{ post.gameName }}</text>
      <text v-if="post.boardName" class="meta__text">{{ post.boardName }}</text>
      <text class="meta__dot">·</text>
      <text class="meta__text">{{ timeText }}</text>
    </view>

    <!-- 作者 -->
    <view class="author">
      <!-- 头像旁边就是作者名，属**装饰图**：给读屏标成 aria-hidden，别让它念两遍 -->
      <image
        v-if="avatar"
        class="author__avatar"
        :src="avatar"
        mode="aspectFill"
        :alt="post.authorName || '作者头像'"
        aria-hidden="true"
        @error="avatarOk = false"
      />
      <view v-else class="author__ph">{{ authorLetter }}</view>
      <view class="author__info">
        <text class="author__name">{{ post.authorName || '匿名玩家' }}</text>
        <text v-if="post.authorLevelTitle" class="author__level">{{ post.authorLevelTitle }}</text>
      </view>
      <text class="author__views">{{ post.viewCount || 0 }} 阅读 · {{ post.likeCount || 0 }} 赞</text>

      <!--
        管理入口（2026-09-26 新增）—— 「权限方案」在本端**可操作**的体现。
        🚨 显示条件看 `showManage`（两段式，见 script 注释）：
           本地角色闸门（有 ADMIN/MODERATOR）→ 再问后端 can-review 精确到「这一篇」。
           游客与普通用户**根本不发这个请求**，所以不会白挨 403。
        面板里的动作清单同样是按角色生成的（置顶仅管理员；隐藏 / 恢复二选一）。
      -->
      <text v-if="showManage" class="author__manage" @click="openManage">管理</text>

      <!-- 举报：未登录先去登录；已登录弹理由选择。提交到主站审核流程（/reports） -->
      <text class="author__report" :class="{ 'author__report--done': reported }" @click="onReportTap">
        {{ reported ? '已举报' : '举报' }}
      </text>
    </view>

    <!-- 模式切换：仅当正文能被拆解时出现 -->
    <view v-if="reading" class="modebar">
      <view class="modebar__btn" :class="{ 'modebar__btn--on': mode === 'card' }" @click="mode = 'card'">
        {{ kindLabel }}
      </view>
      <view class="modebar__btn" :class="{ 'modebar__btn--on': mode === 'raw' }" @click="mode = 'raw'">
        原文模式
      </view>
    </view>

    <!-- 拆解卡（核心亮点） -->
    <view v-if="reading && mode === 'card'">
      <!--
        导语：原文里首个条目**之前**的内容。
        🚨 解析器原来直接把它丢掉（「首个序号之前的前言直接丢弃」），而它通常是作者
          交代背景的那一段（如「DLC 的难度是按你打完本体的后期强度设计的…」），
          丢掉后读者直接看到第 1 条，少了上下文。
      -->
      <view v-if="reading.intro" class="intro">
        <text class="intro__text">{{ reading.intro }}</text>
      </view>

      <template v-for="s in cards" :key="s.index">
        <!--
          分组标题：原文用 `【第一梯队：不做会直接卡关】` 这类整行来分节。
          这类行既不是序号也不是正文，原来会被丢弃 ⇒ 12 张平等的卡片看不出层次。
        -->
        <view v-if="s.showSection" class="sect">
          <view class="sect__bar" />
          <text class="sect__text">{{ s.showSection }}</text>
        </view>
        <StepCard :step="s" />
      </template>

      <!-- 真被截断时必须明说，不能让用户以为看到的就是全部 -->
      <view v-if="reading.truncated" class="tips tips--warn">
        <text class="tips__text">
          ⚠️ 内容较长，已省略 {{ reading.omitted }} 条。请切「原文模式」查看完整正文。
        </text>
      </view>

      <view class="tips">
        <text class="tips__text">
          💡 由前端从原文自动拆解（后端无此字段）。可切「原文模式」查看完整正文。
        </text>
      </view>
    </view>

    <!-- 正文：按区块渲染，**保留正文里的配图**（原来 HTML 全转纯文本，图会被整段丢掉） -->
    <view v-else class="content">
      <template v-for="(b, i) in blocks" :key="i">
        <text v-if="b.type === 'text'" class="content__p">{{ b.text }}</text>
        <image
          v-else-if="!badImgs[i]"
          class="content__img"
          :src="resolveImage(b.src)"
          mode="widthFix"
          :alt="`${post.title || ''} 配图`"
          role="img"
          :aria-label="`${post.title || ''} 配图`"
          @error="onImgError(i)"
          @click="previewImg(b.src)"
        />
      </template>
      <EmptyState v-if="!blocks.length" icon="📄" text="正文为空" />
    </view>

    <!-- 标签 -->
    <view v-if="tags.length" class="tags">
      <text v-for="t in tags" :key="t.id || t.name" class="mp-tag">{{ t.name }}</text>
    </view>

    <!--
      相关推荐 —— **取代了原来的回复区**。
      定位改为「多平台攻略聚合的展示端」后，讨论不在本端出现（弱化互动）；
      而长文读者真正需要的是「下一篇同类的」，不是把页面拖长几百像素的评论区。
      相关度按 同游戏 → 同平台 → 同板块 依次兜底，右侧标出「凭什么相关」。
    -->
    <template v-if="related.length">
      <view class="mp-sec">
        <text class="mp-sec__title">📚 相关攻略</text>
        <text class="mp-sec__more">{{ relatedHint }}</text>
      </view>
      <PostCard v-for="r in related" :key="r.id" :post="r" />
    </template>
    <!-- 补充内容加载失败也要留痕，不能静默留白（否则看起来就像「本来就没有相关攻略」） -->
    <view v-else-if="relatedFailed" class="tips">
      <text class="tips__text" @click="loadRelated(true)">相关攻略加载失败，点此重试</text>
    </view>

    <!--
      底部操作条：**点赞 / 收藏 / 分享**。
      🚨 2026-09-21 口径变更（别再按老理解读这里）：
        · 点赞、收藏**需要登录**，且是**服务端真实接口**（`POST /posts/{id}/like|favorite`）——
          原来它们是「本机记录」（零登录也能点，但不改服务端数据、换设备即丢）。
          现在未登录点击 → 提示 + 跳登录页，不写任何数据（见 `utils/authGate.js`）。
        · **分享不设门禁**：它不写数据也不绑身份，游客照样能复制链接 / 转发
          —— 对内容展示端反而是利好（用户 2026-09-21 明确保留）。
        · 展示的 `likeCount` 始终是服务端数字，点赞成功后用接口回传值刷新，**不做 +1 伪装**。
    -->
    <view v-if="!isNonPublic" class="fab">
      <view class="fab__btn" :class="{ 'fab__btn--on': liked }" @click="onLike">
        {{ liked ? '👍 已赞' : '👍 点赞' }}
      </view>
      <view class="fab__btn" :class="{ 'fab__btn--on': faved }" @click="onFav">
        {{ faved ? '★ 已收藏' : '☆ 收藏' }}
      </view>
      <view class="fab__btn fab__btn--primary" @click="onShare">分享</view>
    </view>

    <!--
      举报弹层 —— 理由预置单选，提交到 `POST /reports`，进入主站审核流程
      （管理员 / 版主在「管理后台 → 举报处理」里看到并处理）。
      🚨 层级铁律：页面内浮层 z-index 必须 > 998（uni-app H5 底栏就是 998），
        这里用 1200（公告浮层同款），否则点选会被底栏拦截。
    -->
    <view v-if="reportSheet" class="rsheet">
      <!--
        🚨 遮罩必须是**独立兄弟节点**，绝不能用 `@click.self` 挂在容器上 ——
        小程序端 uni-app 会**静默丢弃** `.self` 修饰符：编译产物里只剩 `bindtap`，
        完全没有 `e.target !== e.currentTarget` 那层判断（H5 产物里是有的）。
        而 `bindtap` 会冒泡 ⇒ 点任意一个举报理由都会冒到容器上，弹层**当场关掉**
        （2026-09-26 用户实报）。H5 端反而是好的，所以 140 项 H5 回归一条都抓不到：
        **这类「修饰符跨端不一致」只能两端都验。**
      -->
      <view class="rsheet__mask" @click="reportSheet = false"></view>
      <view class="rsheet__panel">
        <text class="rsheet__title">举报这篇内容</text>
        <text class="rsheet__sub">举报后将由社区管理员 / 版主审核处理</text>
        <view
          v-for="(r, i) in REPORT_REASONS"
          :key="r"
          class="rsheet__opt"
          :class="{ 'rsheet__opt--on': reportReasonIdx === i }"
          @click="reportReasonIdx = i"
        >
          <text>{{ r }}</text>
          <text v-if="reportReasonIdx === i" class="rsheet__check">✓</text>
        </view>
        <view class="rsheet__btns">
          <view class="rsheet__btn" @click="reportSheet = false">取消</view>
          <view class="rsheet__btn rsheet__btn--primary" :class="{ 'rsheet__btn--off': reportBusy }" @click="onReportSubmit">
            {{ reportBusy ? '提交中…' : '提交举报' }}
          </view>
        </view>
      </view>
    </view>

    <!--
      管理弹层（2026-09-26 新增）—— 只有 `showManage` 为真时才可能被打开。
      🚨 两条与举报弹层完全相同的铁律（都栽过）：
        ① 遮罩必须是**独立兄弟节点**，绝不能用 `@click.self` —— 小程序端 uni-app 会
           **静默丢弃** `.self` 修饰符，编译产物只剩 `bindtap`，冒泡会把弹层当场关掉
           （点任意一个动作都关，2026-09-26 用户实报）。H5 端反而是好的，
           所以纯 H5 回归一条都抓不到这种「修饰符跨端不一致」。
        ② z-index 必须 > 998（uni-app H5 底栏层级），这里取 1300 压在举报弹层（1200）之上。
      ⚠️ 面板只列后端**真正允许**的动作（`utils/roles.js#actionsFor` 按角色生成）；
        万一边界情况判漏，后端会返回 403 并把原文 toast 出来 —— 那条提示本身就是证据。
    -->
    <view v-if="manageSheet" class="msheet">
      <view class="msheet__mask" @click="manageSheet = false"></view>
      <view class="msheet__panel">
        <text class="msheet__title">管理这篇内容</text>
        <text class="msheet__sub">{{ manageSub }}</text>
        <view
          v-for="a in manageActions"
          :key="a.key"
          class="msheet__opt"
          :class="{ 'msheet__opt--off': !!manageBusy }"
          @click="onManage(a.key)"
        >
          <view class="msheet__opt-body">
            <text class="msheet__opt-label">{{ manageBusy === a.key ? '处理中…' : a.label }}</text>
            <text class="msheet__opt-tip">{{ a.tip }}</text>
          </view>
          <text class="msheet__opt-arrow">›</text>
        </view>
        <view class="msheet__btns">
          <view class="msheet__btn" @click="manageSheet = false">关闭</view>
        </view>
        <text class="msheet__note">
          每次操作都会写入后端审计日志；是否放行由服务端 @PreAuthorize 与板块归属判定，端内只决定「显示什么」。
        </text>
      </view>
    </view>
  </view>

  <!-- 失败：给原因 + 重试，绝不停在骨架屏（原来是 `catch → return`，页面永远转圈） -->
  <view v-else-if="failed" class="mp-page">
    <ErrorState icon="📡" text="帖子加载失败" :sub="errMsg" @retry="load" />
  </view>

  <view v-else class="mp-page">
    <Skeleton :rows="4" />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app'
import { fetchPostDetail, togglePostLike, togglePostFavorite } from '../../api/community'
import { ASSET_BASE } from '../../api/config'
import { resolveImage, formatTime, platformLabel } from '../../utils/format'
import { contentBlocks } from '../../utils/content'
import { parseReading } from '../../utils/stepParser'
import { addHistory, isReported, markReported, getRoles, getUser } from '../../utils/store'
import { requireLogin } from '../../utils/authGate'
import { submitReport } from '../../api/auth'
import { REPORT_REASONS } from '../../api/config'
import {
  canSeeManageEntry,
  shouldShowManageEntry,
  actionsFor,
  permissionSummary
} from '../../utils/roles'
import { fetchCanReview, runManageAction } from '../../api/admin'
import { ensureIndex, relatedOf, patchIndexFlag } from '../../utils/guideIndex'
import PostCard from '../../components/PostCard.vue'
import StepCard from '../../components/StepCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

const post = ref(null)
const tags = ref([])
const mode = ref('card')
const faved = ref(false)
const liked = ref(false)
const failed = ref(false)
const errMsg = ref('')
const avatarOk = ref(true)
const badImgs = ref({})
const postId = ref(0)
/** 底部操作条在途标记：点赞/收藏都是网络请求，防止连点打出重复 toggle */
const fabBusy = ref(false)

/* ==================== 举报（2026-09-17 新增） ==================== */

/**
 * 举报入口与弹层状态。
 * 两道防线防重复：① 本机 `isReported` 置灰入口（体验层）；
 * ② 服务端对同一帖的重复举报有自己的校验，报错会 toast 后端原文。
 */
const reportSheet = ref(false)
const reportReasonIdx = ref(-1)
const reportBusy = ref(false)
const reported = ref(false)

function onReportTap() {
  // 非公开帖（审核中/隐藏）本来就不接收举报，入口只在公开帖出现（模板同 fab 的 v-if）
  if (reported.value) {
    return uni.showToast({ title: '这篇内容你已举报过，管理员会尽快处理', icon: 'none' })
  }
  if (!requireLogin('举报需要先登录（与主站账号通用）')) {
    // 未登录：提示 + 跳登录页（统一走 utils/authGate.js），登录后 navigateBack 自动回到本页
    return
  }
  reportReasonIdx.value = -1
  reportSheet.value = true
}

async function onReportSubmit() {
  if (reportBusy.value) return
  if (reportReasonIdx.value < 0) {
    return uni.showToast({ title: '请先选择一个举报理由', icon: 'none' })
  }
  reportBusy.value = true
  try {
    await submitReport({
      targetId: postId.value,
      reason: REPORT_REASONS[reportReasonIdx.value]
    })
    reportSheet.value = false
    reported.value = true
    markReported(postId.value)
    uni.showToast({ title: '举报已提交，感谢反馈', icon: 'success' })
  } catch (e) {
    /* 失败文案已由请求层 toast 后端原文（如「帖子正在审核中，暂不支持举报」） */
  } finally {
    reportBusy.value = false
  }
}

/**
 * 相关推荐（**取代了原来的回复区**）—— 数据来自端内聚合索引。
 * 定位改成内容展示端后，详情页读完不该只剩「返回」这一条路。
 */
const related = ref([])
const relatedFailed = ref(false)
const relatedHint = ref('')

/** 平台角标配色分组（与 PostCard 的 `.pc__plat--*` 同一套语义） */
const PLAT_KEY = { '多平台': 'multi', PC: 'pc', '主机': 'console', '手机': 'mobile' }
const platKey = computed(() => PLAT_KEY[post.value && post.value.platform] || '')
const platLabel = computed(() => platformLabel(post.value && post.value.platform))

const avatar = computed(() => (avatarOk.value ? resolveImage(post.value && post.value.authorAvatar) : ''))
const authorLetter = computed(() => {
  const n = (post.value && post.value.authorName) || '?'
  return n.charAt(0)
})
const timeText = computed(() => formatTime(post.value && post.value.createdAt))
const blocks = computed(() => contentBlocks(post.value && post.value.content))

/** status=0 才是公开帖；预览态同样按只读处理 */
const isNonPublic = computed(() => {
  const p = post.value
  if (!p) return false
  return (p.status != null && p.status !== 0) || p.previewOnly === true
})
const flagText = computed(() => {
  const p = post.value
  if (!p) return ''
  if (p.previewOnly === true) return '👀 预览模式：该帖未公开，内容仅供审核查看，互动已禁用'
  if (p.status === 2) return '⏳ 该帖正在审核中，仅作者与管理员可见'
  if (p.status === 1) return '🚫 该帖已被隐藏，仅作者与管理员可见'
  return ''
})

/* ==================== 管理权限（2026-09-26 新增） ====================
 * 作业要求 D 里「权限方案」在本端最硬的体现：不是贴个徽章，而是**按角色给出可操作的功能**。
 * 数据链路：后端 `UserInfoVO.roles`（登录 / `/auth/me`）→ `utils/store.js` → 这里。
 */

/** 本地角色（读 storage，0 网络开销） */
const roles = ref([])
/** 当前用户对象（用于把「负责板块」摊开显示在面板副标题里） */
const me = ref(null)
/** 后端 can-review 的**精确**结果（版主是否负责该帖所在板块） */
const canReview = ref(false)
const manageSheet = ref(false)
/** 正在执行的动作 key（'' = 空闲）：用于禁用连点并显示「处理中…」 */
const manageBusy = ref('')

/**
 * 是否显示管理入口。**闸门逻辑在 `utils/roles.js#shouldShowManageEntry`（有单测）**，
 * 这里只做接线。两段式：
 *   ① 本地角色闸门 —— 没有 ADMIN/MODERATOR 就**根本不发** can-review 请求。
 *      为什么必须这样：`/admin/**` 类上挂了 `@PreAuthorize("hasAnyRole('ADMIN','MODERATOR')")`
 *      ⇒ 普通登录用户调**任意**一个（包括 can-review）都会拿到 `code=403`
 *      「无权限（需要管理员角色）」，白挨一次红字提示。
 *   ② 角色通过后再问后端 can-review，精确到「这一篇」。
 *
 * 🚨 **不能只用 canReview 当闸门**：后端 `canReviewPost`（can-review 用的）里有
 *    「自己不能审自己」⇒ 管理员看**自己的帖子**（比如官方公告）时 can-review 恒为 false，
 *    但 `hide` / `essence` / `restore` 其实全都允许（它们走 `assertCanModeratePost`，
 *    ADMIN 直接 return）。只用 canReview 会造出「管理员在自己帖上没有管理入口」的怪现象。
 */
const showManage = computed(() => shouldShowManageEntry(roles.value, canReview.value))

/** 面板里列出的动作：按角色 + 帖子公开性生成（置顶仅管理员；隐藏 / 恢复互斥） */
const manageActions = computed(() => actionsFor(roles.value, { nonPublic: isNonPublic.value }))

/** 面板副标题：把「当前身份 + 权限范围」摊开 —— 答辩时一眼能看出不同账号的权限差异 */
const manageSub = computed(() => {
  const p = permissionSummary(me.value || {})
  return `${p.label} · ${p.scope}`
})

/**
 * 拆解放在前端：后端零改动，现有内容零迁移成本。
 *  · `step`  正文自带序号/小标题 → 真·步骤卡
 *  · `point` 正文是一整段散文   → 按句拆成要点卡
 * 拆不出来时为 null → 退化为普通正文，不报错、不空屏。
 *
 * 返回值除 `items` 外还有：`intro`（导语）、`truncated`/`omitted`（真被截断时页面要提示）、
 * 以及条目上的 `section`（原文的分组标题，如「第一梯队：不做会直接卡关」）。
 */
const reading = computed(() => parseReading(post.value && post.value.content))
const kindLabel = computed(() => (reading.value && reading.value.kind === 'step' ? '步骤模式' : '要点模式'))

/**
 * 给卡片标注「是否要在它前面插一个分组标题」。
 * 同一分组只在**首个**条目上插一次，否则每张卡都会重复一遍「第一梯队…」。
 */
const cards = computed(() => {
  const r = reading.value
  if (!r) return []
  let last = ''
  return r.items.map((it) => {
    const sec = it.section || ''
    const showSection = sec && sec !== last ? sec : ''
    if (sec) last = sec
    return { ...it, showSection }
  })
})

/**
 * 点正文大图 → 系统级大图预览。
 * 原来正文图只能按容器宽度看，攻略里的「面板数值截图 / 地图标注」这类细节根本读不清。
 * urls 传整篇的图，预览时可以直接左右滑着看，不用退出来重新点。
 */
function previewImg(src) {
  const current = resolveImage(src)
  const urls = blocks.value.filter((b) => b.type === 'image').map((b) => resolveImage(b.src)).filter(Boolean)
  if (!current || !urls.length) return
  uni.previewImage({ urls, current })
}

function onImgError(i) {
  // 图挂了就整块移除，不留破图占位
  badImgs.value[i] = true
}

/** 把异常转成一句人话：404 与断网要说清楚区别 */
function describeError(e) {
  const raw = (e && (e.message || e.errMsg)) || ''
  if (/不存在|404/.test(raw)) return '帖子可能已被删除或隐藏'
  if (/timeout|fail|网络/.test(raw)) return '网络异常，请检查网络后重试'
  return raw || '请稍后重试'
}

async function load() {
  const id = postId.value
  if (!id) return
  failed.value = false
  errMsg.value = ''
  // 角色与当前用户：本地读取（0 请求），用于管理入口的显示判定
  roles.value = getRoles()
  me.value = getUser()
  try {
    const d = await fetchPostDetail(id)
    post.value = d
    // 🚨 标签直接取详情返回的 `d.tags`（PostVO 自带）——
    //   **不要**调 `GET /posts/{id}/tags`：后端该路径只注册了 PUT（发帖人改标签），
    //   GET 会 405「请求方法不支持：GET」（2026-09-17 实测踩坑）。
    tags.value = (d && Array.isArray(d.tags)) ? d.tags : []
    // 点赞 / 收藏的初始态**以服务端为准**（2026-09-21 起）：
    //   登录态下 `PostVO` 才带 `liked` / `favorited`（后端批量查 likes / favorite 表），
    //   游客拿到的是 undefined ⇒ 一律按「未点赞 / 未收藏」渲染 —— 与门禁口径一致，
    //   也**不能**再退回本机记录去猜（那正是这次要去掉的东西）。
    faved.value = !!d && d.favorited === true
    liked.value = !!d && d.liked === true
    reported.value = isReported(id)
    if (d) addHistory(d) // 记录浏览历史（本地）
  } catch (e) {
    failed.value = true
    errMsg.value = describeError(e)
    return
  }

  // 管理权限探测：先过本地角色闸门，通过才问后端（不阻塞正文，失败静默）
  probeManage()
  // 相关推荐是**补充内容**，失败不影响正文阅读
  loadRelated()
}

/**
 * 探测「这一篇我能不能管」。
 *
 * 前提：本地角色已确认是 ADMIN / MODERATOR —— 否则**不该发这个请求**
 * （普通用户调 `/admin/**` 必得 code 403，见 `showManage` 注释）。
 * 失败一律按「无权限」处理：探测不成功就不显示入口，绝不因此打扰用户。
 */
async function probeManage() {
  canReview.value = false
  if (!canSeeManageEntry(roles.value)) return
  try {
    const r = await fetchCanReview(postId.value)
    canReview.value = !!(r && r.canReview === true)
  } catch (e) {
    canReview.value = false
  }
}

/** 打开管理面板（没有任何可用动作时不打开，避免出现空面板） */
function openManage() {
  if (!manageActions.value.length) {
    return uni.showToast({ title: '当前身份没有可用的管理动作', icon: 'none' })
  }
  manageSheet.value = true
}

/**
 * 执行一个管理动作。
 *
 * 🚨 与点赞 / 收藏同一套铁律：**不做乐观更新** ——
 *   成功与否只看服务端响应，成功后**重新拉一次详情**（`load()`）让页面回到服务端事实。
 *   理由：这些接口都是 toggle 语义（置顶 / 加精），本地推演在连点下会漂；
 *      而隐藏 / 恢复会改 `status`，本地根本推不准（还会影响计数列）。
 *
 * ⚠️ 失败时**什么都不做**：请求层会把后端原文 toast 出来 ——
 *   越权时的「无权限审核该 (游戏, 板块) 帖子」正是「后端才是安全边界」的证据，别吞掉它。
 */
async function onManage(key) {
  if (manageBusy.value) return
  manageBusy.value = key
  try {
    const r = (await runManageAction(key, postId.value)) || {}
    manageSheet.value = false
    uni.showToast({ title: manageDoneText(key, r), icon: 'none', duration: 1800 })
    await load()
  } catch (e) {
    /* 失败文案已由请求层 toast 后端原文；本地状态保持不变 */
  } finally {
    manageBusy.value = ''
  }
}

/**
 * 用服务端回传的开关值说人话。
 * `setPin` → `isTop`、`setEssence` → `isEssence`（后端返回的是 1 / 0 数值，
 * 不是布尔 —— 0 是 falsy 所以直接用没问题，但别写成 `=== true`）。
 */
function manageDoneText(key, r) {
  if (key === 'pin') return r.isTop ? '已置顶' : '已取消置顶'
  if (key === 'essence') return r.isEssence ? '已加精' : '已取消加精'
  if (key === 'hide') return '已隐藏，仅作者与管理员可见'
  if (key === 'restore') return '已恢复公开'
  return '操作成功'
}

/**
 * 相关推荐 —— 相关度按 同游戏 → 同平台 → 同板块 依次兜底（见 guideIndex#relatedOf）。
 *
 * 🚨 失败必须留痕：`relatedFailed` 会让页面显示「加载失败，点此重试」。
 *   若这里静默清空，页面看起来就和「本来就没有相关攻略」一模一样 ——
 *   正是本项目反复踩的那类坑（故障被空态伪装成事实）。
 */
async function loadRelated(force = false) {
  relatedFailed.value = false
  try {
    const res = await ensureIndex({ force })
    const items = res.items || []
    const p = post.value || {}
    // 索引记录带 `platform`，详情接口不带 —— 从索引回填一次，算相关度要用
    const self = items.find((it) => it.id === p.id)
    if (self && self.platform) p.platform = self.platform

    const list = relatedOf(items, p, 4)
    related.value = list
    const sameGame = list.filter((r) => p.gameName && r.gameName === p.gameName).length
    relatedHint.value = sameGame
      ? sameGame < list.length
        ? `同《${p.gameName}》 + 同平台`
        : `同《${p.gameName}》`
      : p.platform
        ? '同平台 / 同板块'
        : ''
  } catch (e) {
    related.value = []
    relatedFailed.value = true
  }
}

onLoad((q = {}) => {
  postId.value = Number(q.id) || 0
  load()
})

/**
 * 点赞 —— **服务端真实接口**（2026-09-21 口径变更：原来只是「本机记录」）。
 *
 * 三件事必须守住：
 *  ① **未登录先拦下**：`requireLogin` 给提示并跳登录页，**不写任何数据**；
 *  ② 状态以**接口返回值**为准（`r.liked` / `r.likeCount`），不在本地自己取反 ——
 *     后端是 toggle 语义，连点两下时本地推演会漂；
 *  ③ 成功后用 `patchIndexFlag` 把结果写回端内索引缓存，否则「我的」页的点赞列表
 *     要等到下一次同步（TTL 10 分钟）才更新。
 *
 * ⚠️ 不做乐观更新：失败时本地状态保持不变。这个项目对「把失败伪装成成功」零容忍，
 *   一个先亮起来、失败后不回滚的点赞按钮正是那类伪装。
 */
async function onLike() {
  if (!post.value || fabBusy.value) return
  if (!requireLogin('点赞需要先登录（与主站账号通用）')) return
  fabBusy.value = true
  try {
    const r = await togglePostLike(post.value.id)
    liked.value = r.liked === true
    // 服务端回传的才是真值（页面一直展示服务端数字，这里同步成最新）
    if (typeof r.likeCount === 'number') post.value.likeCount = r.likeCount
    patchIndexFlag(post.value.id, { liked: liked.value })
    uni.showToast({ title: liked.value ? '已点赞' : '已取消点赞', icon: 'none', duration: 1500 })
  } catch (e) {
    /* 失败文案已由请求层 toast 后端原文；本地状态保持不变 */
  } finally {
    fabBusy.value = false
  }
}

/** 收藏 —— 同 `onLike`（服务端真实接口 + 登录门禁 + 回写索引） */
async function onFav() {
  if (!post.value || fabBusy.value) return
  if (!requireLogin('收藏需要先登录（与主站账号通用）')) return
  fabBusy.value = true
  try {
    const r = await togglePostFavorite(post.value.id)
    faved.value = r.favorited === true
    patchIndexFlag(post.value.id, { favorited: faved.value })
    uni.showToast({ title: faved.value ? '已加入收藏' : '已取消收藏', icon: 'none', duration: 1500 })
  } catch (e) {
    /* 同上 */
  } finally {
    fabBusy.value = false
  }
}

function onShare() {
  // #ifdef MP-WEIXIN
  uni.showToast({ title: '点击右上角「···」转发给好友', icon: 'none', duration: 2000 })
  // #endif
  // #ifndef MP-WEIXIN
  // 站点地址走 ASSET_BASE（config.js 单一来源），不在这里硬编码 IP —— 换域名时只需改一处
  const link = `${ASSET_BASE}/m/#/pages/post/detail?id=${post.value && post.value.id}`
  uni.setClipboardData({
    data: link,
    success: () => uni.showToast({ title: '链接已复制', icon: 'none', duration: 1500 })
  })
  // #endif
}

// 小程序分享卡片（H5 端该钩子为空操作）
onShareAppMessage(() => ({
  title: (post.value && post.value.title) || 'YUMU 游戏助手',
  path: `/pages/post/detail?id=${(post.value && post.value.id) || ''}`
}))
</script>

<style scoped>
.mp-page {
  padding-bottom: 160rpx;
}
/* 非公开帖横幅 */
.flag {
  background: rgba(240, 159, 39, 0.14);
  border: 1rpx solid rgba(240, 159, 39, 0.4);
  border-radius: 16rpx;
  padding: 18rpx 22rpx;
  margin-bottom: 22rpx;
}
.flag__text {
  font-size: 23rpx;
  color: #f0b45f;
  line-height: 1.6;
}
.title {
  display: block;
  font-size: 38rpx;
  font-weight: 700;
  color: #e9e7f2;
  line-height: 1.45;
}
.meta {
  display: flex;
  align-items: center;
  margin-top: 16rpx;
}
.meta__text {
  font-size: 23rpx;
  color: #a49eb6;
  margin-left: 12rpx;
}
.meta__dot {
  font-size: 23rpx;
  color: #a49eb6;
  margin-left: 10rpx;
}

.author {
  display: flex;
  align-items: center;
  margin-top: 22rpx;
  padding-bottom: 24rpx;
  border-bottom: 1rpx solid #2a2538;
}
.author__avatar {
  width: 68rpx;
  height: 68rpx;
  border-radius: 50%;
  flex: none;
}
.author__ph {
  width: 68rpx;
  height: 68rpx;
  border-radius: 50%;
  background: #3a3350;
  color: #cbbdff;
  font-size: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.author__info {
  flex: 1;
  min-width: 0;
  margin-left: 18rpx;
}
.author__name {
  display: block;
  font-size: 27rpx;
  color: #e9e7f2;
}
.author__level {
  display: block;
  margin-top: 4rpx;
  font-size: 21rpx;
  color: #f0b45f;
}
.author__views {
  font-size: 22rpx;
  color: #a49eb6;
}
/*
  管理入口（管理员 / 版主可见）
  与「举报」同处作者行但**必须一眼分开**：举报是灰色低调小字，这里是紫色描边胶囊 ——
  提权操作要显眼，但不能抢正文视线。
*/
.author__manage {
  flex-shrink: 0;
  margin-left: 10rpx;
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  border: 1rpx solid rgba(124, 92, 255, 0.5);
  background: rgba(124, 92, 255, 0.14);
  color: #cbbdff;
  font-size: 22rpx;
  line-height: 1.7;
}

/* 举报入口：低调小字，低频负面操作不抢视线；已举报后置灰 */
.author__report {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #8b8599;
  padding: 4rpx 10rpx;
}
.author__report--done {
  color: #5d5773;
}

/* 举报弹层 —— 🚨 z-index 必须 > 998（uni-app H5 底栏层级），与公告浮层同用 1200 */
.rsheet {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
/* 遮罩单独一层（**不要**改回 `@click.self`，见模板注释）：点遮罩能关，点面板不会误关 */
.rsheet__mask {
  position: absolute;
  inset: 0;
  background: rgba(10, 8, 18, 0.7);
}
.rsheet__panel {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 760px;
  box-sizing: border-box;
  background: #1a1725;
  border-radius: 28rpx 28rpx 0 0;
  padding: 32rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
}
.rsheet__title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: #f2f0f7;
}
.rsheet__sub {
  display: block;
  margin: 8rpx 0 24rpx;
  font-size: 22rpx;
  color: #8b8599;
}
.rsheet__opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 20rpx;
  margin-bottom: 16rpx;
  border: 1rpx solid #2c2740;
  border-radius: 14rpx;
  color: #c9c4d8;
  font-size: 28rpx;
}
.rsheet__opt--on {
  border-color: #7c5cff;
  background: rgba(124, 92, 255, 0.12);
  color: #f2f0f7;
}
.rsheet__check {
  color: #7c5cff;
  font-weight: 700;
}
.rsheet__btns {
  display: flex;
  gap: 20rpx;
  margin-top: 8rpx;
}
.rsheet__btn {
  flex: 1;
  height: 84rpx;
  line-height: 84rpx;
  text-align: center;
  border-radius: 16rpx;
  border: 1rpx solid #3a3350;
  color: #a49eb6;
  font-size: 28rpx;
}
.rsheet__btn--primary {
  background: #7c5cff;
  border-color: #7c5cff;
  color: #fff;
  font-weight: 600;
}
.rsheet__btn--off {
  opacity: 0.6;
}

/* ==================== 管理弹层 ====================
   与举报弹层同构（同样的「遮罩独立兄弟节点」铁律，见模板注释），
   只是 z-index 取 1300 压在 rsheet（1200）之上。
*/
.msheet {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.msheet__mask {
  position: absolute;
  inset: 0;
  background: rgba(10, 8, 18, 0.7);
}
.msheet__panel {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 760px;
  box-sizing: border-box;
  background: #1a1725;
  border-radius: 28rpx 28rpx 0 0;
  padding: 32rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
}
.msheet__title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: #f2f0f7;
}
.msheet__sub {
  display: block;
  margin: 8rpx 0 24rpx;
  font-size: 22rpx;
  color: #8b8599;
}
.msheet__opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 22rpx;
  margin-bottom: 14rpx;
  border: 1rpx solid #2c2740;
  border-radius: 14rpx;
  background: #201c2e;
}
.msheet__opt--off {
  opacity: 0.55;
}
.msheet__opt-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.msheet__opt-label {
  font-size: 28rpx;
  color: #f2f0f7;
}
.msheet__opt-tip {
  margin-top: 6rpx;
  font-size: 21rpx;
  color: #8b8599;
}
.msheet__opt-arrow {
  flex: none;
  margin-left: 14rpx;
  font-size: 30rpx;
  color: #8b8599;
}
.msheet__btns {
  display: flex;
  margin-top: 8rpx;
}
.msheet__btn {
  flex: 1;
  height: 84rpx;
  line-height: 84rpx;
  text-align: center;
  border-radius: 16rpx;
  border: 1rpx solid #3a3350;
  color: #a49eb6;
  font-size: 28rpx;
}
.msheet__note {
  display: block;
  margin-top: 18rpx;
  font-size: 20rpx;
  color: #6f6982;
  line-height: 1.6;
}

.modebar {
  display: flex;
  margin: 24rpx 0 6rpx;
  background: #231f31;
  border-radius: 16rpx;
  padding: 6rpx;
}
.modebar__btn {
  flex: 1;
  text-align: center;
  font-size: 25rpx;
  color: #a49eb6;
  padding: 12rpx 0;
  border-radius: 12rpx;
}
.modebar__btn--on {
  background: rgba(124, 92, 255, 0.22);
  color: #cbbdff;
}

.tips {
  margin: 6rpx 0 20rpx;
}
.tips__text {
  font-size: 21rpx;
  color: #a49eb6;
  line-height: 1.6;
}
/* 真被截断时的提示 —— 要与普通说明区分开，不能让它淹没在灰字里 */
.tips--warn {
  padding: 14rpx 18rpx;
  background: rgba(255, 176, 32, 0.1);
  border: 1rpx solid rgba(255, 176, 32, 0.32);
  border-radius: 14rpx;
}
.tips--warn .tips__text {
  color: #ffce7a;
}

/*
  导语（原文首个条目之前的那段）
  与卡片区分：卡片是「一条条」，导语是「一段话」，用左侧竖线表示「这段是引子」
*/
.intro {
  padding: 18rpx 20rpx;
  margin-bottom: 16rpx;
  background: #1a1725;
  border-left: 6rpx solid #7c5cff;
  border-radius: 0 14rpx 14rpx 0;
}
.intro__text {
  display: block;
  font-size: 25rpx;
  color: #9c96ad;
  line-height: 1.75;
}

/* 分组标题：原文的 `【第一梯队：不做会直接卡关】` */
.sect {
  display: flex;
  align-items: center;
  margin: 26rpx 0 14rpx;
}
.sect__bar {
  flex: none;
  width: 6rpx;
  height: 26rpx;
  border-radius: 3rpx;
  background: #7c5cff;
  margin-right: 12rpx;
}
.sect__text {
  font-size: 25rpx;
  font-weight: 600;
  color: #cbbdff;
  letter-spacing: 1rpx;
}

.content {
  margin-top: 26rpx;
}
.content__p {
  display: block;
  font-size: 28rpx;
  color: #cfcade;
  line-height: 1.85;
  margin-bottom: 20rpx;
}
/* 正文配图：widthFix 按原图比例撑高，圆角与卡片一致 */
.content__img {
  display: block;
  width: 100%;
  border-radius: 16rpx;
  margin: 8rpx 0 22rpx;
  background: #231f31;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: 16rpx;
}
.tags .mp-tag {
  margin: 0 12rpx 12rpx 0;
}

/* 平台角标 —— 与 PostCard 的 `.pc__plat--*` 同一套配色语义（PC 紫 / 主机 青 / 手游 橙 / 多平台 蓝） */
.pcplat {
  flex: none;
  font-size: 20rpx;
  line-height: 1.7;
  padding: 0 12rpx;
  border-radius: 6rpx;
  margin-right: 12rpx;
}
.pcplat--pc {
  background: rgba(124, 92, 255, 0.2);
  color: #cbbdff;
}
.pcplat--console {
  background: rgba(25, 227, 194, 0.16);
  color: #6fe3d0;
}
.pcplat--mobile {
  background: rgba(240, 159, 39, 0.18);
  color: #f0b45f;
}
.pcplat--multi {
  background: rgba(143, 189, 240, 0.18);
  color: #a9cdf5;
}
/* 🚨 uni-text 自带 white-space: pre-line，长游戏名会把 meta 行撑成两行，必须逐个命中。
   ⚠️ `*` 只有 H5 认，微信 WXSS 不支持通配符（wcsc 报 error at token '*' ⇒ 小程序编译失败），
   故用条件编译只给 H5。别去掉 #ifdef。 */
/* #ifdef H5 */
.meta > * {
  white-space: nowrap;
}
/* #endif */

/* 底部操作条 */
.fab {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  padding: 18rpx 28rpx calc(18rpx + env(safe-area-inset-bottom));
  background: #16131f;
  border-top: 1rpx solid #2a2538;
}
.fab__btn {
  flex: 1;
  text-align: center;
  font-size: 26rpx;
  color: #c8c3d6;
  padding: 16rpx 0;
  border-radius: 30rpx;
  background: #231f31;
  margin-right: 14rpx;
}
.fab__btn:last-child {
  margin-right: 0;
}
.fab__btn--on {
  background: rgba(124, 92, 255, 0.22);
  color: #cbbdff;
}
.fab__btn--primary {
  flex: 0 0 160rpx;
  background: #7c5cff;
  color: #fff;
  font-weight: 500;
}
</style>

<template>
  <view v-if="post" class="mp-page">
    <!--
      非公开帖（status=1 隐藏 / 2 待审）横幅。
      🚨 说明：小程序端**不登录**，后端对匿名访问这类帖直接 404（可见性矩阵见 PostServiceImpl#getDetail），
        所以正常拿不到；这里按 `status/previewOnly` 兜底，是为了万一将来接入登录后
        不会把「审核中」的帖子当成正常帖渲染 —— 按主站规则它应当**完全只读**。
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
      底部操作条：**点赞 / 收藏 / 分享** 三个动作，全部是本端真能做的。
      🚨 关于「点赞」的口径（别写成假按钮、也别虚增数据）：
        · 后端 `POST /posts/{id}/like` 在 SecurityConfig 里是 `authenticated()`，
          必须有登录态；本端是零登录的内容浏览端，**拿不到真点赞**；
        · 所以这里与「收藏」用同一套**本机记录**模型：可点亮、可回看、可取消，
          页面展示的 `likeCount` 仍是服务端真实数字，**不做 +1 伪装**；
        · 「我的」页有「我赞过的」列表，用户能看见自己点过的内容。
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
import { fetchPostDetail } from '../../api/community'
import { ASSET_BASE } from '../../api/config'
import { resolveImage, formatTime, platformLabel } from '../../utils/format'
import { contentBlocks } from '../../utils/content'
import { parseReading } from '../../utils/stepParser'
import { addHistory, isFavorite, toggleFavorite, isLiked, toggleLike } from '../../utils/store'
import { ensureIndex, relatedOf } from '../../utils/guideIndex'
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
  try {
    const d = await fetchPostDetail(id)
    post.value = d
    // 🚨 标签直接取详情返回的 `d.tags`（PostVO 自带）——
    //   **不要**调 `GET /posts/{id}/tags`：后端该路径只注册了 PUT（发帖人改标签），
    //   GET 会 405「请求方法不支持：GET」（2026-09-17 实测踩坑）。
    tags.value = (d && Array.isArray(d.tags)) ? d.tags : []
    faved.value = isFavorite(id)
    liked.value = isLiked(id)
    if (d) addHistory(d) // 记录浏览历史（本地）
  } catch (e) {
    failed.value = true
    errMsg.value = describeError(e)
    return
  }

  // 相关推荐是**补充内容**，失败不影响正文阅读
  loadRelated()
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
 * 点赞 —— **本机记录**（后端点赞接口需要登录态，本端零登录）。
 * 展示的 `likeCount` 仍是服务端真实数字，不做 +1 伪装；写满 200 条时如实提示而非静默丢弃。
 */
function onLike() {
  if (!post.value) return
  const r = toggleLike(post.value)
  liked.value = r.on
  if (r.full) {
    uni.showToast({ title: '本机点赞已满 200 条，请先到「我的」清理', icon: 'none', duration: 2000 })
    return
  }
  uni.showToast({ title: r.on ? '已点赞（记录在本机）' : '已取消点赞', icon: 'none', duration: 1500 })
}

function onFav() {
  if (!post.value) return
  const r = toggleFavorite(post.value)
  faved.value = r.on
  if (r.full) {
    uni.showToast({ title: '本机收藏已满 200 条，请先到「我的」清理', icon: 'none', duration: 2000 })
    return
  }
  uni.showToast({ title: r.on ? '已加入收藏' : '已取消收藏', icon: 'none', duration: 1500 })
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
/* 🚨 uni-text 自带 white-space: pre-line，长游戏名会把 meta 行撑成两行，必须逐个命中 */
.meta > * {
  white-space: nowrap;
}

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

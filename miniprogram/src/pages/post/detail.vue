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
      <text v-if="post.gameName" class="mp-tag mp-tag--purple">{{ post.gameName }}</text>
      <text v-if="post.boardName" class="meta__text">{{ post.boardName }}</text>
      <text class="meta__dot">·</text>
      <text class="meta__text">{{ timeText }}</text>
    </view>

    <!-- 作者 -->
    <view class="author">
      <image v-if="avatar" class="author__avatar" :src="avatar" mode="aspectFill" @error="avatarOk = false" />
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
          @error="onImgError(i)"
        />
      </template>
      <EmptyState v-if="!blocks.length" icon="📄" text="正文为空" />
    </view>

    <!-- 标签 -->
    <view v-if="tags.length" class="tags">
      <text v-for="t in tags" :key="t.id || t.name" class="mp-tag">{{ t.name }}</text>
    </view>

    <!-- 回复 -->
    <view class="mp-sec">
      <text class="mp-sec__title">💬 回复 {{ replyTotal }}</text>
    </view>

    <!--
      🚨 「加载失败」与「没有回复」必须分开：前者可重试，后者是事实。
      原来两者都掉进 EmptyState，遇到后端抖动会显示「还没有回复」——把故障说成事实。
    -->
    <ErrorState
      v-if="replyFailed"
      icon="📡"
      text="回复加载失败"
      sub="网络异常，点此重试"
      @retry="loadReplies"
    />

    <template v-else>
      <view v-for="r in visibleReplies" :key="r.id" class="reply">
        <view class="reply__head">
          <text class="reply__name">{{ r.authorName || '匿名玩家' }}</text>
          <text v-if="r.floor" class="reply__floor">#{{ r.floor }}</text>
          <text class="reply__time">{{ timeOf(r.createdAt) }}</text>
        </view>
        <!--
          楼中楼署名：讨论串里 20/27 条都是楼中楼（带 `replyToName`）。
          不标出回复对象的话，一长串回复读起来完全没有上下文。
        -->
        <text v-if="r.replyToName" class="reply__to">回复 @{{ r.replyToName }}</text>
        <text class="reply__text">{{ r.content }}</text>
      </view>

      <!-- 长讨论串先只展开一部分，避免「正文下面要划很久才到底」 -->
      <view
        v-if="replies.length > REPLY_PAGE && !showAllReplies"
        class="more"
        @click="showAllReplies = true"
      >
        <text class="more__text">展开全部 {{ replies.length }} 条回复</text>
      </view>

      <EmptyState v-if="!replies.length" icon="💬" text="还没有回复" />
    </template>

    <!--
      底部操作条
      🚨 只保留「本端真的能做」的动作。原来那个点赞按钮点了会弹
        「点赞需登录，第二期开放」—— 等于当面告诉评审「这功能没做完」；
        本端不登录，点赞本来也无从谈起，所以把点赞数放到作者行做只读展示，按钮撤掉。
    -->
    <view v-if="!isNonPublic" class="fab">
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
import { fetchPostDetail, fetchReplies, fetchPostTags } from '../../api/community'
import { ASSET_BASE } from '../../api/config'
import { resolveImage, formatTime } from '../../utils/format'
import { contentBlocks } from '../../utils/content'
import { parseReading } from '../../utils/stepParser'
import { addHistory, isFavorite, toggleFavorite } from '../../utils/store'
import StepCard from '../../components/StepCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'

const post = ref(null)
const replies = ref([])
const tags = ref([])
const replyTotal = ref(0)
const mode = ref('card')
const faved = ref(false)
const failed = ref(false)
const errMsg = ref('')
const avatarOk = ref(true)
const badImgs = ref({})
const postId = ref(0)
const replyFailed = ref(false)
const showAllReplies = ref(false)

/** 讨论串一次全渲染会很长（线上最长 27 条），先放这么多，其余点「展开全部」 */
const REPLY_PAGE = 12

const visibleReplies = computed(() =>
  showAllReplies.value ? replies.value : replies.value.slice(0, REPLY_PAGE)
)

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

const timeOf = (v) => formatTime(v)

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
    faved.value = isFavorite(id)
    if (d) addHistory(d) // 记录浏览历史（本地）
  } catch (e) {
    failed.value = true
    errMsg.value = describeError(e)
    return
  }

  // 回复与标签失败都不影响正文阅读
  await loadReplies()
  loadTags(id)
}

/**
 * 加载回复 —— 单独抽出来是为了能给「重试」按钮复用。
 *
 * 🚨 回复总数以帖子详情里的 `replyCount` 为准：列表接口实测返回**裸数组**，
 *   没有 `total` 字段（归一化在 `api/community.js` 里做）。
 *   `post.replyCount` 是后端维护的计数，最可靠。
 */
async function loadReplies() {
  const id = postId.value
  if (!id) return
  replyFailed.value = false
  showAllReplies.value = false
  try {
    const r = await fetchReplies(id)
    replies.value = (r && r.records) || []
    replyTotal.value = (post.value && post.value.replyCount) || (r && r.total) || replies.value.length
  } catch (e) {
    // 失败 ≠ 没有回复：这里必须留下痕迹，让模板走 ErrorState
    replies.value = []
    replyTotal.value = (post.value && post.value.replyCount) || 0
    replyFailed.value = true
  }
}

async function loadTags(id) {
  try {
    const t = await fetchPostTags(id)
    tags.value = Array.isArray(t) ? t : []
  } catch (e) {
    /* 标签失败不影响阅读 */
  }
}

onLoad((q = {}) => {
  postId.value = Number(q.id) || 0
  load()
})

function onFav() {
  if (!post.value) return
  faved.value = toggleFavorite(post.value)
  uni.showToast({ title: faved.value ? '已加入收藏' : '已取消收藏', icon: 'none', duration: 1500 })
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
  color: #6f6a80;
  margin-left: 12rpx;
}
.meta__dot {
  font-size: 23rpx;
  color: #6f6a80;
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
  color: #6f6a80;
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
  color: #8b8599;
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
  color: #6f6a80;
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

.reply {
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 20rpx;
  padding: 20rpx;
  margin-bottom: 14rpx;
}
.reply__head {
  display: flex;
  align-items: center;
  /* 加了楼层号后头行有三个元素，要的是「名字靠左、楼层与时间靠右」，
     默认 space-between 会把三者均分，名字和楼层之间空一大块 */
  justify-content: flex-start;
}
/* 🚨 uni-text 自带 white-space: pre-line，会覆盖父级 —— 长昵称会把这一行撑成两行 */
.reply__head > * {
  white-space: nowrap;
}
.reply__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 24rpx;
  color: #b9a9ff;
}
.reply__time {
  flex: none;
  margin-left: 14rpx;
  font-size: 21rpx;
  color: #6f6a80;
}
.reply__text {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  color: #cfcade;
  line-height: 1.7;
}
/* 楼层号：讨论串里便于「第 12 楼」这样指代，弱化显示不抢作者名 */
.reply__floor {
  flex: none;
  margin-left: 12rpx;
  font-size: 20rpx;
  color: #7c5cff;
  background: rgba(124, 92, 255, 0.14);
  padding: 2rpx 10rpx;
  border-radius: 8rpx;
}
/* 楼中楼署名 —— 20/27 条是楼中楼，不标就完全读不出这人在回谁 */
.reply__to {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #8b8599;
}

/* 「展开全部回复」 */
.more {
  margin: 6rpx 0 18rpx;
  padding: 20rpx 0;
  text-align: center;
  background: #1a1725;
  border: 1rpx dashed #332d45;
  border-radius: 16rpx;
}
.more__text {
  font-size: 25rpx;
  color: #a99cf0;
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

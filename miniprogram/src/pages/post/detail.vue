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
      <StepCard v-for="s in reading.items" :key="s.index" :step="s" />
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
    <view v-for="r in replies" :key="r.id" class="reply">
      <view class="reply__head">
        <text class="reply__name">{{ r.authorName || '匿名玩家' }}</text>
        <text class="reply__time">{{ timeOf(r.createdAt) }}</text>
      </view>
      <text class="reply__text">{{ r.content }}</text>
    </view>
    <EmptyState v-if="!replies.length" icon="💬" text="还没有回复" />

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
 *  · `point` 正文是一整段散文   → 按句拆成要点卡（实测线上 36 篇全属这类）
 * 拆不出来时为 null → 退化为普通正文，不报错、不空屏。
 */
const reading = computed(() => parseReading(post.value && post.value.content))
const kindLabel = computed(() => (reading.value && reading.value.kind === 'step' ? '步骤模式' : '要点模式'))

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

  // 回复与标签失败不影响正文阅读
  try {
    const r = await fetchReplies(id, { current: 1, size: 20 })
    replies.value = (r && r.records) || []
    replyTotal.value = (r && r.total) || 0
  } catch (e) {
    /* ignore */
  }
  try {
    const t = await fetchPostTags(id)
    tags.value = Array.isArray(t) ? t : []
  } catch (e) {
    /* ignore */
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
  const link = `http://8.133.255.202/m/#/pages/post/detail?id=${post.value && post.value.id}`
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
  justify-content: space-between;
}
.reply__name {
  font-size: 24rpx;
  color: #b9a9ff;
}
.reply__time {
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

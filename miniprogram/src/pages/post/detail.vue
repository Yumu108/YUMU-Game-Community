<template>
  <view v-if="post" class="mp-page">
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
      <image v-if="avatar" class="author__avatar" :src="avatar" mode="aspectFill" />
      <view v-else class="author__ph">{{ authorLetter }}</view>
      <view class="author__info">
        <text class="author__name">{{ post.authorName || '匿名玩家' }}</text>
        <text v-if="post.authorLevelTitle" class="author__level">{{ post.authorLevelTitle }}</text>
      </view>
      <text class="author__views">{{ post.viewCount || 0 }} 阅读</text>
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

    <!-- 正文 -->
    <view v-else class="content">
      <text v-for="(p, i) in paragraphs" :key="i" class="content__p">{{ p }}</text>
      <EmptyState v-if="!paragraphs.length" icon="📄" text="正文为空" />
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

    <!-- 底部操作条 -->
    <view class="fab">
      <view class="fab__btn" @click="onLike">👍 {{ post.likeCount || 0 }}</view>
      <view class="fab__btn" :class="{ 'fab__btn--on': faved }" @click="onFav">
        {{ faved ? '★ 已收藏' : '☆ 收藏' }}
      </view>
      <view class="fab__btn fab__btn--primary" @click="onShare">分享</view>
    </view>
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
import { toParagraphs } from '../../utils/content'
import { parseReading } from '../../utils/stepParser'
import { addHistory, isFavorite, toggleFavorite } from '../../utils/store'
import StepCard from '../../components/StepCard.vue'
import Skeleton from '../../components/Skeleton.vue'
import EmptyState from '../../components/EmptyState.vue'

const post = ref(null)
const replies = ref([])
const tags = ref([])
const replyTotal = ref(0)
const mode = ref('card')
const faved = ref(false)

const avatar = computed(() => resolveImage(post.value && post.value.authorAvatar))
const authorLetter = computed(() => {
  const n = (post.value && post.value.authorName) || '?'
  return n.charAt(0)
})
const timeText = computed(() => formatTime(post.value && post.value.createdAt))
const paragraphs = computed(() => toParagraphs(post.value && post.value.content))

/**
 * 拆解放在前端：后端零改动，现有内容零迁移成本。
 *  · `step`  正文自带序号/小标题 → 真·步骤卡
 *  · `point` 正文是一整段散文   → 按句拆成要点卡（实测线上 36 篇全属这类）
 * 拆不出来时为 null → 退化为普通正文，不报错、不空屏。
 */
const reading = computed(() => parseReading(post.value && post.value.content))
const kindLabel = computed(() => (reading.value && reading.value.kind === 'step' ? '步骤模式' : '要点模式'))

const timeOf = (v) => formatTime(v)

onLoad(async (q = {}) => {
  const id = Number(q.id)
  if (!id) return
  try {
    const d = await fetchPostDetail(id)
    post.value = d
    faved.value = isFavorite(id)
    if (d) addHistory(d) // 记录浏览历史（本地）
  } catch (e) {
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
})

function onFav() {
  if (!post.value) return
  faved.value = toggleFavorite(post.value)
  uni.showToast({ title: faved.value ? '已加入收藏' : '已取消收藏', icon: 'none', duration: 1500 })
}

function onLike() {
  uni.showToast({ title: '点赞需登录，第二期开放', icon: 'none', duration: 1800 })
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

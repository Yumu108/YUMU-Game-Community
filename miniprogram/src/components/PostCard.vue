<template>
  <view class="pc" @click="onTap">
    <view class="pc__body">
      <view class="pc__head">
        <text v-if="post.isTop" class="pc__badge pc__badge--top">置顶</text>
        <text v-if="post.isEssence" class="pc__badge pc__badge--best">精华</text>
        <text class="pc__title" :class="{ 'pc__title--clamp': clamp }">{{ post.title }}</text>
      </view>

      <text v-if="summary" class="pc__summary" :class="{ 'pc__summary--clamp': clamp }">{{ summary }}</text>

      <view class="pc__meta">
        <text v-if="post.gameName" class="mp-tag mp-tag--purple">{{ post.gameName }}</text>
        <text v-else-if="post.boardName" class="pc__board">{{ post.boardName }}</text>
        <text class="pc__dot">·</text>
        <text class="pc__time">{{ timeText }}</text>
        <view class="pc__spacer" />
        <text class="pc__stat">👍 {{ likeText }}</text>
        <text class="pc__stat">💬 {{ replyText }}</text>
      </view>
    </view>

    <!--
      封面：列表接口的每条帖子都带 `cover`（种子内容覆盖率约 7 成），
      没有封面时退到所属游戏的 `gameCover`，画面不至于整片纯文字。
      ⚠️ 加载失败必须整个移除，不能留一个空框 —— 宁可没有缩略图，也不要破图。
    -->
    <image
      v-if="thumb"
      class="pc__thumb"
      :src="thumb"
      mode="aspectFill"
      @error="onThumbError"
    />
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { formatTime, shortNumber, resolveImage } from '../utils/format'
import { summaryOf } from '../utils/content'

const props = defineProps({
  post: { type: Object, required: true },
  clamp: { type: Boolean, default: true }
})
const emit = defineEmits(['tap'])

const summary = computed(() => summaryOf(props.post, 52))
const timeText = computed(() => formatTime(props.post.createdAt))
const likeText = computed(() => shortNumber(props.post.likeCount))
const replyText = computed(() => shortNumber(props.post.replyCount))

/** 封面优先级：帖子自己的 cover → 所属游戏封面 */
const thumb = ref('')
watch(
  () => [props.post && props.post.cover, props.post && props.post.gameCover],
  ([c, gc]) => {
    thumb.value = resolveImage(c || gc || '')
  },
  { immediate: true }
)
function onThumbError() {
  thumb.value = ''
}

function onTap() {
  emit('tap', props.post)
  uni.navigateTo({ url: `/pages/post/detail?id=${props.post.id}` })
}
</script>

<style scoped>
.pc {
  display: flex;
  align-items: flex-start;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 22rpx;
  padding: 22rpx;
  margin-bottom: 18rpx;
}
.pc__body {
  flex: 1;
  min-width: 0;
}
.pc__thumb {
  flex: none;
  width: 200rpx;
  height: 150rpx;
  margin-left: 20rpx;
  border-radius: 14rpx;
  background: #231f31;
}
.pc__head {
  display: flex;
  align-items: flex-start;
}
.pc__badge {
  flex: none;
  font-size: 20rpx;
  line-height: 1.7;
  padding: 0 10rpx;
  border-radius: 6rpx;
  margin-right: 10rpx;
  /* 与两行标题的首行视觉对齐 */
  margin-top: 6rpx;
}
.pc__badge--top {
  background: rgba(240, 159, 39, 0.16);
  color: #f0b45f;
}
.pc__badge--best {
  background: rgba(124, 92, 255, 0.22);
  color: #cbbdff;
}
.pc__title {
  font-size: 30rpx;
  font-weight: 600;
  color: #e9e7f2;
  flex: 1;
  min-width: 0;
  line-height: 1.4;
}
/* 两行截断：长标题（实测有 30+ 字的）单行读不完，列表里全是「……xxx…」 */
.pc__title--clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pc__summary {
  display: block;
  margin-top: 12rpx;
  font-size: 25rpx;
  color: #8b8599;
  line-height: 1.6;
}
.pc__summary--clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pc__meta {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  /* 元信息行高度必须恒定：长游戏名（「崩坏：星穹铁道」）一旦折行，
     右侧的赞/回复数字会被 align-items:center 拽到第二行，整行看起来错位 */
  overflow: hidden;
  white-space: nowrap;
  margin-top: 16rpx;
  font-size: 22rpx;
  color: #6f6a80;
}
/**
 * 🚨 必须逐个直接命中：uni-app 的 `<text>` 在 H5 渲染成 `uni-text`，
 *   其基础样式带了 `white-space: pre-line` —— **会覆盖从父级继承的 nowrap**，
 *   只写父级 nowrap 是没用的，实测「资讯速递」照样被拆成两行。
 */
.pc__meta > * {
  white-space: nowrap;
}
.pc__meta .mp-tag {
  flex: none;
  max-width: 160rpx;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pc__board {
  flex: none;
  max-width: 200rpx;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pc__dot {
  margin: 0 8rpx;
}
.pc__spacer {
  flex: 1;
}
.pc__stat {
  flex: none;
  margin-left: 12rpx;
}
</style>


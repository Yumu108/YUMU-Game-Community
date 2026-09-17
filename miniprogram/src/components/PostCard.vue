<template>
  <view class="pc" @click="onTap">
    <view class="pc__head">
      <text v-if="post.isTop" class="pc__badge pc__badge--top">置顶</text>
      <text v-if="post.isEssence" class="pc__badge pc__badge--best">精华</text>
      <text class="pc__title" :class="{ 'pc__title--clamp': clamp }">{{ post.title }}</text>
    </view>

    <text v-if="summary" class="pc__summary" :class="{ 'pc__summary--clamp': clamp }">{{ summary }}</text>

    <view class="pc__meta">
      <text v-if="post.gameName" class="mp-tag mp-tag--purple">{{ post.gameName }}</text>
      <text v-if="post.boardName" class="pc__board">{{ post.boardName }}</text>
      <text class="pc__dot">·</text>
      <text class="pc__time">{{ timeText }}</text>
      <view class="pc__spacer" />
      <text class="pc__stat">👍 {{ likeText }}</text>
      <text class="pc__stat">💬 {{ replyText }}</text>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { formatTime, shortNumber } from '../utils/format'
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

function onTap() {
  emit('tap', props.post)
  uni.navigateTo({ url: `/pages/post/detail?id=${props.post.id}` })
}
</script>

<style scoped>
.pc {
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 22rpx;
  padding: 22rpx;
  margin-bottom: 18rpx;
}
.pc__head {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
}
.pc__badge {
  flex: none;
  font-size: 20rpx;
  line-height: 1.7;
  padding: 0 10rpx;
  border-radius: 6rpx;
  margin-right: 10rpx;
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
}
.pc__title--clamp {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  margin-top: 16rpx;
  font-size: 22rpx;
  color: #6f6a80;
}
.pc__board {
  margin-left: 12rpx;
}
.pc__dot {
  margin: 0 8rpx;
}
.pc__spacer {
  flex: 1;
}
.pc__stat {
  margin-left: 18rpx;
}
</style>

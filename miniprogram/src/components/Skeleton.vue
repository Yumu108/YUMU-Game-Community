<template>
  <view class="sk">
    <view v-for="i in rows" :key="i" class="sk__card">
      <view class="sk__line sk__line--title" />
      <view class="sk__line sk__line--sub" />
      <view class="sk__line sk__line--sub sk__line--short" />
    </view>
  </view>
</template>

<script setup>
/** 骨架屏：首屏占位，避免白屏。行数可配。 */
defineProps({
  rows: { type: Number, default: 3 }
})
</script>

<style scoped>
.sk__card {
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 22rpx;
  padding: 24rpx;
  margin-bottom: 18rpx;
}
.sk__line {
  height: 26rpx;
  border-radius: 8rpx;
  background: #262133;
  margin-bottom: 14rpx;
  animation: sk-pulse 1.4s ease-in-out infinite;
}
.sk__line--title {
  width: 70%;
  height: 30rpx;
}
.sk__line--sub {
  width: 100%;
}
.sk__line--short {
  width: 45%;
  margin-bottom: 0;
}
@keyframes sk-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
</style>

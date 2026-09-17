<template>
  <view class="empty">
    <text class="empty__icon">{{ icon }}</text>
    <text class="empty__text">{{ text }}</text>
    <text v-if="sub" class="empty__sub">{{ sub }}</text>
  </view>
</template>

<script setup>
defineProps({
  icon: { type: String, default: '🎮' },
  text: { type: String, default: '这里还没有内容' },
  sub: { type: String, default: '' }
})
</script>

<style scoped>
.empty {
  padding: 80rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.empty__icon {
  font-size: 64rpx;
  line-height: 1;
  opacity: 0.6;
}
.empty__text {
  margin-top: 20rpx;
  font-size: 27rpx;
  color: #a49eb6;
}
.empty__sub {
  margin-top: 10rpx;
  font-size: 23rpx;
  color: #a49eb6;
  text-align: center;
}
</style>

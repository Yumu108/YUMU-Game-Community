<template>
  <view class="step" :class="{ 'step--active': active }">
    <view class="step__no">
      <text class="step__no-text">{{ step.index }}</text>
    </view>
    <view class="step__body">
      <text class="step__title">{{ step.title }}</text>
      <text v-if="step.desc" class="step__desc">{{ step.desc }}</text>
    </view>
  </view>
</template>

<script setup>
/**
 * 攻略步骤卡 —— 详情页的核心呈现单元。
 * 由 `utils/stepParser.js` 从长文里切出来，后端不含任何步骤字段。
 */
defineProps({
  step: { type: Object, required: true },
  active: { type: Boolean, default: false }
})
</script>

<style scoped>
.step {
  display: flex;
  align-items: flex-start;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 20rpx;
  padding: 22rpx;
  margin-bottom: 16rpx;
}
.step--active {
  background: #221d33;
  border-color: #7c5cff;
}
.step__no {
  flex: none;
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  background: rgba(124, 92, 255, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 18rpx;
}
.step__no-text {
  font-size: 26rpx;
  font-weight: 600;
  color: #cbbdff;
}
.step__body {
  flex: 1;
  min-width: 0;
}
.step__title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #e9e7f2;
  line-height: 1.5;
}
.step__desc {
  display: block;
  margin-top: 10rpx;
  font-size: 25rpx;
  color: #8b8599;
  line-height: 1.65;
}
</style>

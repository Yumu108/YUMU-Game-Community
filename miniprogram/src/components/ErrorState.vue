<template>
  <view class="err">
    <text class="err__icon">{{ icon }}</text>
    <text class="err__text">{{ text }}</text>
    <text v-if="sub" class="err__sub">{{ sub }}</text>
    <view v-if="retryable" class="err__btn" @click="onRetry">重试</view>
  </view>
</template>

<script setup>
/**
 * 请求失败态 —— **必须与 EmptyState 分开**。
 *
 * 🚨 踩过的坑（2026-09-17 体检）：原来所有页面 catch 里都是 `list.value = []`，
 *   于是「后端连不上」被渲染成「没有找到匹配的游戏 / 换个关键词或清掉筛选试试」——
 *   把系统故障说成「内容本来就没有」，用户既看不到真相、也没有任何自救入口
 *   （只能靠下拉刷新，而下拉刷新在失败时什么提示都没有）。
 *
 * 判定原则：**只有请求成功且结果为空，才算空数据；请求失败一律走本组件。**
 */
defineProps({
  icon: { type: String, default: '⚠️' },
  text: { type: String, default: '加载失败' },
  sub: { type: String, default: '' },
  retryable: { type: Boolean, default: true }
})
const emit = defineEmits(['retry'])

function onRetry() {
  emit('retry')
}
</script>

<style scoped>
.err {
  padding: 80rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.err__icon {
  font-size: 60rpx;
  line-height: 1;
  opacity: 0.7;
}
.err__text {
  margin-top: 22rpx;
  font-size: 27rpx;
  color: #c8c3d6;
}
.err__sub {
  margin-top: 10rpx;
  font-size: 23rpx;
  color: #a49eb6;
  text-align: center;
}
.err__btn {
  margin-top: 28rpx;
  padding: 14rpx 52rpx;
  border-radius: 30rpx;
  font-size: 26rpx;
  color: #cbbdff;
  background: rgba(124, 92, 255, 0.2);
  border: 1rpx solid #7c5cff;
}
</style>
